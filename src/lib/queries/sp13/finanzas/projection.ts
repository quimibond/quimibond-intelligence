import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F5 — Cash projection día-a-día (probability-weighted).
 *
 * Sources:
 * - `canonical_bank_balances` → saldo inicial (classification='cash').
 * - `cashflow_projection` → pre-computed invoice-level projections with
 *   `collection_probability` derived from aging bucket (fresh 95%, 1-30d
 *   85%, 31-60d 70%, 61-90d 50%, 90+ 25%). We use `expected_amount`
 *   (residual × probability) for inflows and raw `amount_residual` for
 *   outflows (we owe the full thing).
 *
 * flow_type column values:
 *   - `receivable_detail` → AR rows per invoice (inflow)
 *   - `payable_detail`    → AP rows per invoice (outflow)
 *   - `receivable_by_month` → aggregated monthly totals (ignored here)
 *
 * Partes relacionadas (intercompañía):
 * Cualquier AP/AR cuyo company_id apunte a una entidad marcada
 * `is_related_party=true` en canonical_companies (familia Mizrahi +
 * Grupo Quimibond) se push 180d (fuera del horizonte 13/30/90), por
 * lo que NO contamina `outflowByDay`/`inflowByDay`, `totalOutflow`/
 * `totalInflow` ni los markers. Solo aparece en `categoryTotals` como
 * `ap_intercompania`/`ar_intercompania` para visibilidad informativa.
 * Detección autoritativa por RFC en canonical_companies, con respaldo
 * por flag heredado de get_ap_payment_delay_v2 (defensa en profundidad).
 *
 * Past-due con backlog grande:
 * Cuando `due_date + supplier_delay` sigue siendo < today, distribuimos
 * vía spreadPastDue() sobre [today, today + max(delay, 14)] en vez de
 * "dump on today" (que producía cliffs artificiales de millones cuando
 * el 90%+ del AP está vencido).
 *
 * Pipeline confirmado (SOs sin facturar) — best practices:
 * Sale orders con state='sale' donde qty_invoiced < qty (filter age <180d
 * para excluir zombies; medido: 93% del pending nominal son SOs >180d
 * olvidadas). Por línea se separa:
 *   - delivered_pending = min(qty_delivered, qty) − qty_invoiced
 *     → factura inminente, prob 0.95, payment = today + CFDI_LAG (3d) + AR_delay
 *   - undelivered_pending = pending_total − delivered_pending
 *     → delivery_date = max(today, commitment_date or order_date+lead)
 *       (lead default 7d, P75 histórico Quimibond del medido en deliveries)
 *     → invoice_date = delivery_date + CFDI_LAG (3d)
 *     → payment_date = invoice_date + AR_delay del cliente
 *     → probabilidad por tier de edad: <30d=0.85, 30-90d=0.70, 90-180d=0.45
 * Categoría separada `ventas_confirmadas` para distinguirla de `ar_cobranza`
 * (factura ya emitida) y `ventas_proyectadas` (run rate estadístico).
 *
 * Markers: cualquier flujo ≥ 50k MXN se emite como marker visible.
 */
export interface CashProjectionPoint {
  date: string;
  balance: number;
  inflow: number;
  outflow: number;
}

export interface CashProjectionMarker {
  date: string;
  kind: "inflow" | "outflow";
  amount: number;
  label: string;
  companyId: number | null;
  probability: number | null;
  atRisk: boolean;
  /** ar_cobranza | ap_proveedores | nomina | renta | servicios | arrendamiento | impuestos_sat | ventas_proyectadas */
  category: string;
  categoryLabel: string;
}

export interface CashFlowCategoryTotal {
  category: string;
  categoryLabel: string;
  flowType: "inflow" | "outflow";
  amountMxn: number;
}

export interface CashProjection {
  horizonDays: number;
  openingBalance: number;
  minBalance: number;
  minBalanceDate: string;
  closingBalance: number;
  totalInflow: number;
  totalOutflow: number;
  totalInflowNominal: number;
  avgCollectionProbability: number | null;
  overdueInflowCount: number;
  safetyFloor: number;
  points: CashProjectionPoint[];
  markers: CashProjectionMarker[];
  // Breakdown por categoría (incluye AR/AP factura por factura + recurrentes
  // proyectados desde patrón histórico de los últimos 3 meses).
  categoryTotals: CashFlowCategoryTotal[];
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function _getCashProjectionRaw(horizonDays: number): Promise<CashProjection> {
  const sb = getServiceClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIso(today);
  const endDate = new Date(today.getTime() + horizonDays * 86400000);
  const endIso = toIso(endDate);

  // Cutoff para SOs confirmadas: solo las recientes (últimos 6 meses)
  // porque las viejas con pending probablemente ya están en "rotted"
  // (cliente no va a recibir/facturar) y meterlas infla el inflow.
  const soSinceIso = toIso(new Date(today.getTime() - 180 * 86400000));

  const [
    cashRes,
    projRes,
    recurringRes,
    apDelayRes,
    arDelayRes,
    relatedRfcRes,
    soHeaderRes,
    soLinesRes,
  ] = await Promise.all([
      sb
        .from("canonical_bank_balances")
        .select("classification, current_balance_mxn"),
      sb
        .from("cashflow_projection")
        .select(
          "company_id, flow_type, projected_date, amount_residual, expected_amount, collection_probability, invoice_name, days_overdue"
        )
        .in("flow_type", ["receivable_detail", "payable_detail"])
        .lte("projected_date", endIso),
      // Recurring inflows/outflows desde patrón histórico (nómina, renta,
      // servicios, arrendamiento, ventas proyectadas). RPC silver.
      sb.rpc("get_cash_projection_recurring", {
        p_horizon_days: horizonDays,
        p_lookback_months: 3,
      }),
      // Delay promedio histórico de pago AP por proveedor — para no proyectar
      // que pagamos todo en su due date (sobreestima salidas de cash).
      sb.rpc("get_ap_payment_delay_v2", { p_lookback_months: 6 }),
      // Delay promedio histórico de cobranza AR por cliente — refleja que
      // los clientes nos pagan X días después del vencimiento (no en el
      // due date). Sin esto, la cobranza esperada llega antes de cuando
      // realmente cobramos.
      sb.rpc("get_ar_collection_delay_v2", { p_lookback_months: 6 }),
      // RFCs de partes relacionadas (familia Mizrahi + Grupo Quimibond).
      // Marcadas en canonical_companies.is_related_party=true. Las usamos
      // para excluir TOTALMENTE cualquier AP/AR intercompañía del cashflow.
      sb
        .from("canonical_companies")
        .select("rfc")
        .eq("is_related_party", true)
        .not("rfc", "is", null),
      // Sale orders confirmadas pero NO facturadas: header con commitment_date
      // para fechar la cobranza esperada. cashflow_projection solo tiene
      // facturas emitidas; este pipeline confirmado es backlog comprometido
      // que entrará a AR cuando se facture (entrega + lead time).
      sb
        .from("odoo_sale_orders")
        .select(
          "odoo_order_id, name, date_order, commitment_date, company_id, currency"
        )
        .eq("state", "sale")
        .gte("date_order", soSinceIso),
      // Líneas de SO con qty/qty_invoiced para calcular pending pendiente
      // de facturar por cada orden.
      sb
        .from("odoo_order_lines")
        .select(
          "odoo_order_id, qty, qty_invoiced, qty_delivered, subtotal_mxn"
        )
        .eq("order_type", "sale")
        .eq("order_state", "sale")
        .gte("order_date", soSinceIso)
        .gt("qty", 0)
        .gt("subtotal_mxn", 0),
    ]);

  // Set autoritativo de Bronze company.id para partes relacionadas.
  // Source of truth: canonical_companies.is_related_party = true (marcado
  // por RFC en migration 20260426_ap_delay_related_party.sql). Resolvemos
  // a Bronze IDs vía companies.rfc (mismo RFC = misma entidad fiscal).
  //
  // No dependemos del flag is_related_party que retorna get_ap_payment_delay_v2
  // porque ese RPC requiere ≥3 facturas pagadas en el lookback — partes
  // relacionadas con poco movimiento operativo se quedan fuera del map y
  // sus invoices accidentalmente entrarían a la proyección como AP normal.
  const relatedRfcs = ((relatedRfcRes.data ?? []) as Array<{ rfc: string | null }>)
    .map((r) => r.rfc)
    .filter((r): r is string => !!r);
  const relatedPartyIds = new Set<number>();
  if (relatedRfcs.length > 0) {
    const { data: bronzeRows } = await sb
      .from("companies")
      .select("id")
      .in("rfc", relatedRfcs);
    for (const c of (bronzeRows ?? []) as Array<{ id: number | null }>) {
      if (c.id != null) relatedPartyIds.add(c.id);
    }
  }

  // Mapa company_id → { delay days, is_related_party }
  type ApDelayRow = {
    company_id: number;
    avg_delay_days: number;
    sample_size: number;
    median_delay_days: number;
    is_related_party: boolean;
  };
  const apDelayRows = (apDelayRes.data ?? []) as ApDelayRow[];
  const apDelayMap = new Map<
    number,
    { delayDays: number; isRelatedParty: boolean }
  >();
  for (const r of apDelayRows) {
    // Use median (más robusto contra outliers) cuando la muestra es chica.
    const days = r.sample_size >= 10 ? r.avg_delay_days : r.median_delay_days;
    apDelayMap.set(r.company_id, {
      delayDays: days,
      isRelatedParty: r.is_related_party,
    });
    // Propagar al set autoritativo (defensa en profundidad)
    if (r.is_related_party) relatedPartyIds.add(r.company_id);
  }

  type ArDelayRow = {
    company_id: number;
    avg_delay_days: number;
    sample_size: number;
    median_delay_days: number;
  };
  const arDelayRows = (arDelayRes.data ?? []) as ArDelayRow[];
  const arDelayMap = new Map<number, number>();
  for (const r of arDelayRows) {
    const days = r.sample_size >= 10 ? r.avg_delay_days : r.median_delay_days;
    arDelayMap.set(r.company_id, days);
  }

  const shiftDate = (iso: string, days: number): string => {
    if (days <= 0) return iso;
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return toIso(d);
  };

  // Para AR/AP que ya rebasaron su fecha esperada de pago (incluso
  // después de aplicar delay histórico), distribuimos sobre una ventana
  // realista en vez de "dump on today". Sin esto, el chart muestra un
  // cliff artificial el día 1 cuando hay backlog grande de past-due
  // (típico en AP de Quimibond: ~91% del residual está past-due).
  const PAST_DUE_SPREAD_MIN_DAYS = 14;
  const stableHash = (key: string): number => {
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  const spreadPastDue = (
    shiftedIso: string,
    delayDays: number,
    invoiceKey: string
  ): string => {
    if (shiftedIso >= todayIso) return shiftedIso;
    const span = Math.max(delayDays > 0 ? delayDays : 0, PAST_DUE_SPREAD_MIN_DAYS);
    const offset = stableHash(invoiceKey) % span;
    return shiftDate(todayIso, offset);
  };

  type Bank = { classification: string | null; current_balance_mxn: number | null };
  const banks = (cashRes.data ?? []) as Bank[];
  const opening = banks
    .filter((b) => b.classification === "cash")
    .reduce((s, b) => s + (Number(b.current_balance_mxn) || 0), 0);

  type ProjRow = {
    company_id: number | null;
    flow_type: string | null;
    projected_date: string | null;
    amount_residual: number | null;
    expected_amount: number | null;
    collection_probability: number | null;
    invoice_name: string | null;
    days_overdue: number | null;
  };
  const projRows = (projRes.data ?? []) as ProjRow[];

  const inflowByDay = new Map<string, number>();
  const outflowByDay = new Map<string, number>();
  const markers: CashProjectionMarker[] = [];
  const MARKER_THRESHOLD = 50000;

  let totalInflow = 0;
  let totalOutflow = 0;
  let totalInflowNominal = 0;
  let probSum = 0;
  let probCount = 0;
  let overdueInflowCount = 0;

  // Acumulador de totales por categoría
  const categoryAcc = new Map<
    string,
    { label: string; flowType: "inflow" | "outflow"; amount: number }
  >();
  const addToCategory = (
    cat: string,
    label: string,
    flow: "inflow" | "outflow",
    amount: number
  ) => {
    const existing = categoryAcc.get(cat);
    if (existing) existing.amount += amount;
    else categoryAcc.set(cat, { label, flowType: flow, amount });
  };

  for (const r of projRows) {
    const origDate = r.projected_date;
    if (!origDate) continue;
    const isInflow = r.flow_type === "receivable_detail";
    const nominal = Number(r.amount_residual) || 0;
    const expected = Number(r.expected_amount ?? r.amount_residual) || 0;
    if (expected <= 0) continue;

    // Detección autoritativa de partes relacionadas: si el company_id
    // pertenece al set RFC-based (canonical_companies.is_related_party),
    // o si apDelayMap lo marcó (invoice ya pagada con flag heredado),
    // tratamos la fila como intercompañía.
    const isRelatedParty =
      (r.company_id != null && relatedPartyIds.has(r.company_id)) ||
      (r.company_id != null &&
        apDelayMap.get(r.company_id)?.isRelatedParty === true);

    // Aplicar delay histórico (proveedor para AP, cliente para AR) sobre
    // el due date original.
    //  - intercompañía → push 180d FUERA del horizonte. NO contamina
    //    outflowByDay, totalOutflow ni markers; solo aparece en el
    //    breakdown como categoría aparte (ver CLAUDE.md /finanzas).
    //  - factura no vencida + delay 30d → pagamos/cobramos due+30d
    //  - factura vencida 10d con delay 30d → esperada en today + 20d
    //  - factura vencida 60d con delay 30d → past-due post-delay;
    //    spreadPastDue() la distribuye sobre [today, today + max(delay, 14)]
    //    para evitar cliff artificial cuando hay backlog grande past-due.
    const invoiceKey =
      r.invoice_name ?? `${r.flow_type}-${r.company_id}-${origDate}-${nominal}`;
    let date = origDate;
    let delayForSpread = 0;
    if (isRelatedParty) {
      date = shiftDate(origDate, 180);
    } else if (r.company_id != null) {
      if (!isInflow) {
        const delay = apDelayMap.get(r.company_id);
        if (delay && delay.delayDays > 0) {
          delayForSpread = delay.delayDays;
          date = shiftDate(origDate, delay.delayDays);
        }
      } else {
        const delayDays = arDelayMap.get(r.company_id);
        if (delayDays != null && delayDays > 0) {
          delayForSpread = delayDays;
          date = shiftDate(origDate, delayDays);
        }
      }
    }
    if (!isRelatedParty) {
      date = spreadPastDue(date, delayForSpread, invoiceKey);
    }

    if (isInflow) {
      if (isRelatedParty) {
        // AR intercompañía: visibilidad en breakdown, fuera del flujo diario.
        addToCategory(
          "ar_intercompania",
          "AR a partes relacionadas (intercompañía)",
          "inflow",
          expected
        );
        continue;
      }
      inflowByDay.set(date, (inflowByDay.get(date) ?? 0) + expected);
      totalInflow += expected;
      totalInflowNominal += nominal;
      addToCategory(
        "ar_cobranza",
        "Cobranza AR (factura emitida)",
        "inflow",
        expected
      );
      if (r.collection_probability != null) {
        probSum += Number(r.collection_probability);
        probCount++;
      }
      if ((r.days_overdue ?? 0) > 0) overdueInflowCount++;
    } else if (isRelatedParty) {
      // AP intercompañía: visibilidad en breakdown, fuera del flujo
      // diario y del total operativo (push 180d ya descarta del horizonte).
      addToCategory(
        "ap_intercompania",
        "AP a partes relacionadas (intercompañía)",
        "outflow",
        nominal
      );
    } else {
      outflowByDay.set(date, (outflowByDay.get(date) ?? 0) + nominal);
      totalOutflow += nominal;
      addToCategory(
        "ap_proveedores",
        "AP a proveedores (factura recibida)",
        "outflow",
        nominal
      );
    }

    const amtForMarker = isInflow ? expected : nominal;
    if (!isRelatedParty && amtForMarker >= MARKER_THRESHOLD) {
      markers.push({
        date,
        kind: isInflow ? "inflow" : "outflow",
        amount: amtForMarker,
        label: r.invoice_name ?? "",
        companyId: r.company_id,
        probability:
          r.collection_probability == null
            ? null
            : Number(r.collection_probability),
        atRisk: isInflow && (r.days_overdue ?? 0) > 0,
        category: isInflow ? "ar_cobranza" : "ap_proveedores",
        categoryLabel: isInflow ? "Cobranza AR" : "AP a proveedor",
      });
    }
  }

  // ── Sale orders confirmadas pero NO facturadas (pipeline) ────────────
  // Best practices aplicadas (B2B textile manufacturer, MX context):
  //
  // 1. VALIDEZ del pedido — solo SOs con order_date en últimos 180d
  //    (filtrado en query). 93% del pending nominal está en SOs zombie
  //    de >180d (ej. PV04308 desde 2022-09 con $4.1M pendiente que en
  //    realidad fueron olvidadas en state='sale'). Filtrarlas evita
  //    inflar inflows con backlog ficticio.
  //
  // 2. SPLIT por estado de entrega — calcula por línea:
  //    - delivered_pending = max(0, min(qty_delivered, qty) - qty_invoiced)
  //      → ya entregado, falta emitir CFDI. Probabilidad alta (0.95),
  //      facturación inminente (today + CFDI_LAG).
  //    - undelivered_pending = pending_total - delivered_pending
  //      → pendiente entrega + factura. Probabilidad por tier de edad.
  //
  // 3. TIMING chain con datos reales Quimibond (medidos del histórico):
  //    - Lead order_date → delivery: median 2d, P75 7d, P90 15d
  //    - CFDI_LAG (delivery → factura): 3d (CFDI emitido casi inmediato)
  //    - delivery_date_estimada =
  //        commitment_date (si futura)
  //        ∨ today (si commitment_date pasada — late delivery)
  //        ∨ order_date + SO_LEAD_DEFAULT (si no hay commitment_date)
  //    - invoice_date_estimada = delivery_date + CFDI_LAG
  //    - payment_date_estimada = invoice_date + AR_delay del cliente
  //
  // 4. PROBABILIDAD por tier (más conservador que un flat 0.85):
  //    - delivered_pending: 0.95 (factura inminente, riesgo solo si CFDI rebota)
  //    - undelivered, age <30d: 0.85
  //    - undelivered, age 30-90d: 0.70
  //    - undelivered, age 90-180d: 0.45 (riesgo retraso producción/cancel)
  //
  // 5. EXCLUIR partes relacionadas (consistente con AP/AR — push 180d)
  const CFDI_EMISSION_LAG_DAYS = 3;
  const SO_LEAD_DEFAULT_DAYS = 7; // P75 histórico Quimibond

  type SoHeader = {
    odoo_order_id: number | null;
    name: string | null;
    date_order: string | null;
    commitment_date: string | null;
    company_id: number | null;
    currency: string | null;
  };
  type SoLine = {
    odoo_order_id: number | null;
    qty: number | null;
    qty_invoiced: number | null;
    qty_delivered: number | null;
    subtotal_mxn: number | null;
  };
  const soHeaders = new Map<number, SoHeader>();
  for (const h of (soHeaderRes.data ?? []) as SoHeader[]) {
    if (h.odoo_order_id != null) soHeaders.set(h.odoo_order_id, h);
  }
  // Por orden: sumar (delivered_pending_amt, undelivered_pending_amt)
  const pendingByOrder = new Map<
    number,
    { deliveredAmt: number; undeliveredAmt: number }
  >();
  for (const l of (soLinesRes.data ?? []) as SoLine[]) {
    if (l.odoo_order_id == null) continue;
    const qty = Number(l.qty) || 0;
    const qtyInv = Number(l.qty_invoiced) || 0;
    const qtyDel = Number(l.qty_delivered) || 0;
    const sub = Number(l.subtotal_mxn) || 0;
    if (qty <= 0 || sub <= 0) continue;
    const pendingQty = qty - qtyInv;
    if (pendingQty <= 0) continue;
    const pricePerUnit = sub / qty;
    const deliveredPendingQty = Math.max(0, Math.min(qtyDel, qty) - qtyInv);
    const undeliveredPendingQty = pendingQty - deliveredPendingQty;
    const existing = pendingByOrder.get(l.odoo_order_id) ?? {
      deliveredAmt: 0,
      undeliveredAmt: 0,
    };
    existing.deliveredAmt += deliveredPendingQty * pricePerUnit;
    existing.undeliveredAmt += undeliveredPendingQty * pricePerUnit;
    pendingByOrder.set(l.odoo_order_id, existing);
  }

  const probabilityForUndelivered = (ageDays: number): number => {
    if (ageDays < 30) return 0.85;
    if (ageDays < 90) return 0.70;
    if (ageDays < 180) return 0.45;
    return 0; // skip — caería al filtro pero por seguridad
  };

  const pushPipelineInflow = (
    header: SoHeader,
    nominal: number,
    paymentDateIso: string,
    probability: number,
    suffix: string
  ) => {
    if (nominal <= 0 || paymentDateIso > endIso) return;
    const expected = nominal * probability;
    inflowByDay.set(
      paymentDateIso,
      (inflowByDay.get(paymentDateIso) ?? 0) + expected
    );
    totalInflow += expected;
    totalInflowNominal += nominal;
    addToCategory(
      "ventas_confirmadas",
      "Ventas confirmadas (SO sin facturar)",
      "inflow",
      expected
    );
    if (expected >= MARKER_THRESHOLD) {
      markers.push({
        date: paymentDateIso,
        kind: "inflow",
        amount: expected,
        label: header.name ? `${header.name} ${suffix}` : `SO ${suffix}`,
        companyId: header.company_id,
        probability,
        atRisk: false,
        category: "ventas_confirmadas",
        categoryLabel: "Ventas confirmadas (SO sin facturar)",
      });
    }
  };

  for (const [orderId, amts] of pendingByOrder) {
    if (amts.deliveredAmt <= 0 && amts.undeliveredAmt <= 0) continue;
    const header = soHeaders.get(orderId);
    if (!header || !header.date_order) continue;
    if (header.company_id != null && relatedPartyIds.has(header.company_id)) {
      continue;
    }
    const arDelay =
      header.company_id != null ? arDelayMap.get(header.company_id) ?? 30 : 30;

    // Tier A: delivered pending (factura inminente, prob 0.95)
    if (amts.deliveredAmt > 0) {
      const invoiceIso = shiftDate(todayIso, CFDI_EMISSION_LAG_DAYS);
      const paymentIso = shiftDate(invoiceIso, Math.max(arDelay, 0));
      pushPipelineInflow(header, amts.deliveredAmt, paymentIso, 0.95, "(entregado)");
    }

    // Tier B: undelivered pending — prob por edad del SO
    if (amts.undeliveredAmt > 0) {
      const ageDays = Math.max(
        0,
        Math.floor(
          (today.getTime() - new Date(header.date_order).getTime()) / 86400000
        )
      );
      const prob = probabilityForUndelivered(ageDays);
      if (prob <= 0) continue;
      // delivery_date estimada
      let deliveryIso: string;
      if (header.commitment_date && header.commitment_date >= todayIso) {
        deliveryIso = header.commitment_date;
      } else if (header.commitment_date) {
        // Compromiso pasado (entrega tarde) — asumir today + lead/2
        deliveryIso = shiftDate(todayIso, Math.ceil(SO_LEAD_DEFAULT_DAYS / 2));
      } else {
        const fromOrder = shiftDate(header.date_order, SO_LEAD_DEFAULT_DAYS);
        deliveryIso = fromOrder < todayIso ? todayIso : fromOrder;
      }
      const invoiceIso = shiftDate(deliveryIso, CFDI_EMISSION_LAG_DAYS);
      const paymentIso = shiftDate(invoiceIso, Math.max(arDelay, 0));
      pushPipelineInflow(header, amts.undeliveredAmt, paymentIso, prob, "(pipeline)");
    }
  }
  // Procesar recurring flows del RPC silver (nómina, renta, servicios,
  // arrendamiento, ventas proyectadas).
  type RecRow = {
    projected_date: string;
    category: string;
    category_label: string;
    flow_type: string;
    amount_mxn: number | string;
    probability: number | string | null;
    notes: string | null;
  };
  // Estas categorías llegan como factura del proveedor (arrendador, CFE,
  // Telmex, etc.) y entran al cashflow_projection vía AP. Si la fecha
  // proyectada del recurrente cae en el pasado del mes corriente, asumimos
  // que la factura ya está en el AP y NO la duplicamos via overlay.
  // Nómina + impuestos_sat + ventas_proyectadas no llegan como factura,
  // siempre se proyectan.
  const FACTURED_CATS = new Set(["renta", "servicios", "arrendamiento"]);
  const recRows = (recurringRes.data ?? []) as RecRow[];
  for (const r of recRows) {
    if (FACTURED_CATS.has(r.category) && r.projected_date < todayIso) {
      continue;
    }
    const date = r.projected_date < todayIso ? todayIso : r.projected_date;
    const amount = Number(r.amount_mxn) || 0;
    if (amount <= 0) continue;
    const isInflow = r.flow_type === "recurring_inflow";
    if (isInflow) {
      inflowByDay.set(date, (inflowByDay.get(date) ?? 0) + amount);
      totalInflow += amount;
      addToCategory(r.category, r.category_label, "inflow", amount);
    } else {
      outflowByDay.set(date, (outflowByDay.get(date) ?? 0) + amount);
      totalOutflow += amount;
      addToCategory(r.category, r.category_label, "outflow", amount);
      // Marker visible para outflows recurrentes grandes
      if (amount >= MARKER_THRESHOLD) {
        markers.push({
          date,
          kind: "outflow",
          amount,
          label: r.category_label,
          companyId: null,
          probability: r.probability == null ? null : Number(r.probability),
          atRisk: false,
          category: r.category,
          categoryLabel: r.category_label,
        });
      }
    }
  }

  const points: CashProjectionPoint[] = [];
  let running = opening;
  let minBal = opening;
  let minDate = todayIso;

  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const iso = toIso(d);
    const inflow = inflowByDay.get(iso) ?? 0;
    const outflow = outflowByDay.get(iso) ?? 0;
    running += inflow - outflow;
    if (running < minBal) {
      minBal = running;
      minDate = iso;
    }
    points.push({ date: iso, balance: Math.round(running), inflow, outflow });
  }

  markers.sort((a, b) => a.date.localeCompare(b.date));

  // Convert categoryAcc to sorted array (inflows desc, then outflows desc)
  const categoryTotals: CashFlowCategoryTotal[] = Array.from(
    categoryAcc.entries()
  )
    .map(([category, v]) => ({
      category,
      categoryLabel: v.label,
      flowType: v.flowType,
      amountMxn: Math.round(v.amount),
    }))
    .sort((a, b) => {
      if (a.flowType !== b.flowType)
        return a.flowType === "inflow" ? -1 : 1;
      return b.amountMxn - a.amountMxn;
    });

  return {
    horizonDays,
    openingBalance: Math.round(opening),
    closingBalance: points.at(-1)?.balance ?? Math.round(opening),
    minBalance: Math.round(minBal),
    minBalanceDate: minDate,
    totalInflow: Math.round(totalInflow),
    totalOutflow: Math.round(totalOutflow),
    totalInflowNominal: Math.round(totalInflowNominal),
    avgCollectionProbability:
      probCount > 0 ? Math.round((probSum / probCount) * 100) / 100 : null,
    overdueInflowCount,
    safetyFloor: 500000,
    points,
    markers: markers.slice(0, 40),
    categoryTotals,
  };
}

export const getCashProjection = unstable_cache(
  _getCashProjectionRaw,
  ["sp13-finanzas-cash-projection-v11-so-tiered"],
  { revalidate: 600, tags: ["finanzas"] }
);

export type CashProjectionHorizon = 13 | 30 | 90;

export function parseProjectionHorizon(
  raw: string | string[] | undefined,
  fallback: CashProjectionHorizon = 13
): CashProjectionHorizon {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v ? parseInt(v, 10) : NaN;
  if (n === 13 || n === 30 || n === 90) return n;
  return fallback;
}
