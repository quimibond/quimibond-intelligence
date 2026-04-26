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
 * IVA: se aplica el ratio del header `amount_total_mxn / amount_untaxed_mxn`
 * por SO. Cliente exento (export USA, tasa 0%) → factor 1.0; cliente normal
 * → 1.16; SOs con líneas mixtas → blended. Default 1.16 sólo si header
 * viene con totales 0/null (raro).
 *
 * Modelo de tres capas para inflows (sin duplicación):
 *   1. AR ya facturado (cashflow_projection.receivable_detail) — con IVA
 *   2. SO confirmadas pero no facturadas — con IVA via tax factor
 *   3. Run rate per cliente activo (last 90d / 3 = monthly avg con IVA),
 *      descontando bucket 1+2 weighted en horizonte para evitar duplicar.
 *      Probabilidad 0.70 (estadístico). Reemplaza `ventas_proyectadas`
 *      del RPC recurring (que era proxy global, no per-customer, y
 *      duplicaba con AR existente).
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

/**
 * Evento individual del cashflow para drill-down. A diferencia de los
 * markers (que solo emite eventos ≥$50k para pintar burbujas en el chart),
 * `events` contiene TODOS los flujos modelados: cada factura AR, cada AP,
 * cada recurrente, cada SO pipeline tier, y residual de run rate por
 * cliente. Permite que la timeline expanda una semana y vea todo.
 */
export interface ProjectionEvent {
  date: string; // YYYY-MM-DD ISO
  kind: "inflow" | "outflow";
  /** Monto que mueve la curva (con probabilidad aplicada para inflows). */
  amountMxn: number;
  /** Monto nominal antes de probability discount (para AP = igual a amount). */
  nominalAmountMxn: number;
  label: string;
  category: string;
  categoryLabel: string;
  probability: number | null;
  companyId: number | null;
  counterpartyName: string | null;
  daysOverdue: number | null;
}

export interface CustomerCashflowRow {
  customerId: number; // Bronze companies.id
  customerName: string;
  monthlyAvgMxn: number; // run rate (con IVA)
  expectedInHorizonMxn: number; // monthly_avg × horizon_proportion
  bucket1WeightedMxn: number; // AR ya facturada, weighted en horizonte
  bucket2WeightedMxn: number; // SO pipeline weighted en horizonte
  bucket3ExpectedMxn: number; // run rate residual × 0.70 prob
  totalExpectedMxn: number; // suma de las 3 capas weighted
  saturationPct: number | null; // (bucket1+2) / expected_horizon × 100
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
  // TODOS los flujos individuales modelados (sin threshold, sin cap).
  // Cada AR/AP/recurrente/SO pipeline/run rate residual aquí. Para
  // drill-down de la timeline al expandir una semana.
  events: ProjectionEvent[];
  // Breakdown por categoría (incluye AR/AP factura por factura + recurrentes
  // proyectados desde patrón histórico de los últimos 3 meses).
  categoryTotals: CashFlowCategoryTotal[];
  // Top clientes con desglose de inflow esperado: AR ya facturado, SO
  // pipeline, residual de run rate. Saturación = (bucket1+2)/run_rate
  // → muestra qué clientes tienen pipeline cubriendo su demanda vs
  // dónde la capa 3 (residual) está aportando.
  customerInflowBreakdown: CustomerCashflowRow[];
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

  // Lookback nómina: últimos 6 meses cerrados (más robusto vs outliers
  // mensuales y permite usar mediana). Extraído client-side para tener
  // control sobre qué cuentas y aplicar mediana + exclusión de one-offs.
  const nominaLookbackFromMonth = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const lastClosedMonth = (() => {
    const d = new Date(today.getFullYear(), today.getMonth(), 0); // último día del mes anterior
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const [
    cashRes,
    projRes,
    recurringRes,
    apDelayRes,
    arDelayRes,
    relatedRfcRes,
    soHeaderRes,
    soLinesRes,
    nominaBalancesRes,
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
      // amount_total_mxn / amount_untaxed_mxn = tax factor para escalar
      // las líneas (subtotal_mxn está SIN IVA; el cliente paga CON IVA).
      sb
        .from("odoo_sale_orders")
        .select(
          "odoo_order_id, name, date_order, commitment_date, company_id, currency, amount_total_mxn, amount_untaxed_mxn"
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
      // Cuentas de nómina contable últimos 6 meses cerrados.
      // Calculado client-side para excluir one-offs (Reyes, indemnización,
      // prima antigüedad esporádica) y usar mediana en lugar de promedio.
      // Reemplaza el cálculo del RPC `get_cash_projection_recurring` para
      // la categoría 'nomina'.
      sb
        .from("canonical_account_balances")
        .select("period, account_code, balance")
        .eq("balance_sheet_bucket", "expense")
        .eq("deprecated", false)
        .or(
          "account_code.like.501.06.*,account_code.like.602.01.*,account_code.like.602.02.*,account_code.like.602.03.*,account_code.like.602.04.*,account_code.like.602.05.*,account_code.like.602.06.*,account_code.like.602.07.*,account_code.like.602.08.*,account_code.like.602.09.*,account_code.like.602.10.*,account_code.like.602.11.*,account_code.like.602.12.*,account_code.like.602.13.*,account_code.like.602.14.*,account_code.like.602.15.*,account_code.like.602.16.*,account_code.like.602.17.*,account_code.like.602.18.*,account_code.like.602.19.*,account_code.like.602.20.*,account_code.like.602.21.*,account_code.like.602.22.*,account_code.like.602.23.*,account_code.like.602.24.*,account_code.like.602.25.*,account_code.like.603.01.*,account_code.like.603.02.*,account_code.like.603.03.*,account_code.like.603.04.*,account_code.like.603.05.*,account_code.like.603.06.*,account_code.like.603.07.*,account_code.like.603.08.*,account_code.like.603.09.*,account_code.like.603.10.*,account_code.like.603.11.*,account_code.like.603.12.*,account_code.like.603.13.*,account_code.like.603.14.*,account_code.like.603.15.*,account_code.like.603.16.*,account_code.like.603.17.*,account_code.like.603.18.*,account_code.like.603.19.*,account_code.like.603.20.*,account_code.like.603.21.*,account_code.like.603.22.*,account_code.like.603.23.*,account_code.like.603.24.*,account_code.like.603.25.*"
        )
        .gte("period", nominaLookbackFromMonth)
        .lte("period", lastClosedMonth),
    ]);

  // Capa 3: run rate por cliente activo. Pulled separately después del
  // primer batch para no cargar el Promise.all con dependencias cruzadas.
  // Tomamos los últimos 90 días de canonical_invoices issued con IVA
  // (amount_total_mxn_resolved) — es el cash que el cliente NOS paga.
  const customerLookbackIso = toIso(new Date(today.getTime() - 90 * 86400000));
  const customerInvRes = await sb
    .from("canonical_invoices")
    .select(
      "receptor_canonical_company_id, amount_total_mxn_resolved, invoice_date"
    )
    .eq("direction", "issued")
    .eq("is_quimibond_relevant", true)
    .or("estado_sat.is.null,estado_sat.neq.cancelado")
    .gte("invoice_date", customerLookbackIso)
    .gt("amount_total_mxn_resolved", 0);

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
  const events: ProjectionEvent[] = [];
  const pushEvent = (e: ProjectionEvent) => {
    if (e.amountMxn <= 0) return;
    if (e.date > endIso) return;
    events.push(e);
  };
  const MARKER_THRESHOLD = 50000;

  let totalInflow = 0;
  let totalOutflow = 0;
  let totalInflowNominal = 0;
  let probSum = 0;
  let probCount = 0;
  let overdueInflowCount = 0;
  // Tracker bucket 1 weighted por cliente (cobranza esperada de facturas
  // ya emitidas, con IVA — amount_residual incluye impuestos). Usado en
  // capa 3 para no duplicar con run rate.
  const bucket1WeightedByCustomer = new Map<number, number>();

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
      pushEvent({
        date,
        kind: "inflow",
        amountMxn: expected,
        nominalAmountMxn: nominal,
        label: r.invoice_name ?? "Cobranza AR",
        category: "ar_cobranza",
        categoryLabel: "Cobranza AR (factura emitida)",
        probability:
          r.collection_probability == null
            ? null
            : Number(r.collection_probability),
        companyId: r.company_id,
        counterpartyName: null,
        daysOverdue: r.days_overdue ?? null,
      });
      if (r.company_id != null && date <= endIso) {
        bucket1WeightedByCustomer.set(
          r.company_id,
          (bucket1WeightedByCustomer.get(r.company_id) ?? 0) + expected
        );
      }
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
      pushEvent({
        date,
        kind: "outflow",
        amountMxn: nominal,
        nominalAmountMxn: nominal,
        label: r.invoice_name ?? "Pago a proveedor",
        category: "ap_proveedores",
        categoryLabel: "AP a proveedores (factura recibida)",
        probability: null,
        companyId: r.company_id,
        counterpartyName: null,
        daysOverdue: r.days_overdue ?? null,
      });
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
    amount_total_mxn: number | null;
    amount_untaxed_mxn: number | null;
  };
  const DEFAULT_IVA_FACTOR = 1.16; // IVA general MX 16%
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
    pushEvent({
      date: paymentDateIso,
      kind: "inflow",
      amountMxn: expected,
      nominalAmountMxn: nominal,
      label: header.name ? `${header.name} ${suffix}` : `SO ${suffix}`,
      category: "ventas_confirmadas",
      categoryLabel: "Ventas confirmadas (SO sin facturar)",
      probability,
      companyId: header.company_id,
      counterpartyName: null,
      daysOverdue: null,
    });
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

  // Tracker de pipeline weighted por cliente (para descontar en capa 3
  // y evitar duplicar con run rate).
  const bucket2WeightedByCustomer = new Map<number, number>();

  for (const [orderId, amts] of pendingByOrder) {
    if (amts.deliveredAmt <= 0 && amts.undeliveredAmt <= 0) continue;
    const header = soHeaders.get(orderId);
    if (!header || !header.date_order) continue;
    if (header.company_id != null && relatedPartyIds.has(header.company_id)) {
      continue;
    }
    const arDelay =
      header.company_id != null ? arDelayMap.get(header.company_id) ?? 30 : 30;

    // IVA factor: amount_total_mxn / amount_untaxed_mxn del header del SO.
    // Las líneas guardan subtotal_mxn (sin IVA); el cobro real al cliente
    // incluye IVA. Si no hay header data válido, default 1.16.
    const headerUntaxed = Number(header.amount_untaxed_mxn) || 0;
    const headerTotal = Number(header.amount_total_mxn) || 0;
    const taxFactor =
      headerUntaxed > 0 && headerTotal > 0
        ? headerTotal / headerUntaxed
        : DEFAULT_IVA_FACTOR;
    const deliveredWithIva = amts.deliveredAmt * taxFactor;
    const undeliveredWithIva = amts.undeliveredAmt * taxFactor;

    const trackBucket2 = (expectedAmt: number) => {
      if (header.company_id == null) return;
      bucket2WeightedByCustomer.set(
        header.company_id,
        (bucket2WeightedByCustomer.get(header.company_id) ?? 0) + expectedAmt
      );
    };

    // Tier A: delivered pending (factura inminente, prob 0.95)
    if (deliveredWithIva > 0) {
      const invoiceIso = shiftDate(todayIso, CFDI_EMISSION_LAG_DAYS);
      const paymentIso = shiftDate(invoiceIso, Math.max(arDelay, 0));
      if (paymentIso <= endIso) trackBucket2(deliveredWithIva * 0.95);
      pushPipelineInflow(header, deliveredWithIva, paymentIso, 0.95, "(entregado)");
    }

    // Tier B: undelivered pending — prob por edad del SO
    if (undeliveredWithIva > 0) {
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
      if (paymentIso <= endIso) trackBucket2(undeliveredWithIva * prob);
      pushPipelineInflow(header, undeliveredWithIva, paymentIso, prob, "(pipeline)");
    }
  }

  // ── Capa 3: Run rate por cliente activo (last 90d) ─────────────────────
  // Para cada cliente con facturación reciente, proyecta su demanda mensual
  // promedio (con IVA — usamos amount_total_mxn_resolved que es el total
  // que el cliente paga, incluyendo o no IVA según su régimen). El run rate
  // se reduce por:
  //   - bucket 1 (AR ya emitida): cobranza esperada en horizonte
  //   - bucket 2 (SO confirmada sin facturar): pipeline weighted en horizonte
  // Solo el RESIDUAL = max(0, expected_in_horizon − bucket1 − bucket2)
  // se agrega como inflow de "demanda nueva esperada", evitando duplicar
  // los flujos ya capturados en capas 1 y 2.
  //
  // Probabilidad 0.70 (estadística — el cliente típicamente compra esto
  // pero no está comprometido para este horizonte). Lower que SO pipeline
  // (0.85-0.95) por la incertidumbre de demanda futura.
  //
  // Cliente activo = facturó al menos 1 vez en últimos 90d, no es parte
  // relacionada, y no está en blacklist (canonical_companies.blacklist_status
  // si existe — por ahora solo filtramos partes relacionadas).
  type CustomerInvRow = {
    receptor_canonical_company_id: number | null;
    amount_total_mxn_resolved: number | null;
    invoice_date: string | null;
  };
  const customerInvRows = (customerInvRes.data ?? []) as CustomerInvRow[];
  // canonical_company_id → bronze companies.id mapping no es directo;
  // canonical_invoices.receptor_canonical_company_id es canonical id,
  // mientras que cashflow_projection y SOs usan companies.id (Bronze).
  // Para descontar bucket 1 + 2 (Bronze ids) del run rate (canonical id),
  // resolvemos vía canonical_companies → companies join por odoo_partner_id.
  const canonicalIdsWithRevenue = new Set<number>();
  for (const r of customerInvRows) {
    if (r.receptor_canonical_company_id != null) {
      canonicalIdsWithRevenue.add(r.receptor_canonical_company_id);
    }
  }
  const canonicalToBronzeMap = new Map<number, number>();
  if (canonicalIdsWithRevenue.size > 0) {
    const ids = [...canonicalIdsWithRevenue];
    const { data: ccData } = await sb
      .from("canonical_companies")
      .select("id, odoo_partner_id")
      .in("id", ids)
      .not("odoo_partner_id", "is", null);
    type CcRow = { id: number | null; odoo_partner_id: number | null };
    const partnerIds: number[] = [];
    const ccByPartner = new Map<number, number>();
    for (const c of (ccData ?? []) as CcRow[]) {
      if (c.id != null && c.odoo_partner_id != null) {
        partnerIds.push(c.odoo_partner_id);
        ccByPartner.set(c.odoo_partner_id, c.id);
      }
    }
    if (partnerIds.length > 0) {
      const { data: bronzeData } = await sb
        .from("companies")
        .select("id, odoo_partner_id")
        .in("odoo_partner_id", partnerIds);
      for (const b of (bronzeData ?? []) as Array<{
        id: number | null;
        odoo_partner_id: number | null;
      }>) {
        if (b.id != null && b.odoo_partner_id != null) {
          const cid = ccByPartner.get(b.odoo_partner_id);
          if (cid != null) canonicalToBronzeMap.set(cid, b.id);
        }
      }
    }
  }

  // Run rate mensual por cliente: SUM(invoiced last 90d con IVA) / 3
  const monthlyRunRateByCanonical = new Map<number, number>();
  for (const r of customerInvRows) {
    const cid = r.receptor_canonical_company_id;
    if (cid == null) continue;
    const amt = Number(r.amount_total_mxn_resolved) || 0;
    monthlyRunRateByCanonical.set(
      cid,
      (monthlyRunRateByCanonical.get(cid) ?? 0) + amt
    );
  }
  const RUN_RATE_PROBABILITY = 0.7;
  const horizonProportion = horizonDays / 30;
  // Tracker per-customer para construir la tabla de breakdown al final.
  // key = Bronze company id. monthlyAvg/expectedHorizon en MXN con IVA.
  const customerBreakdown = new Map<
    number,
    { monthlyAvg: number; expectedHorizon: number; bucket3Expected: number }
  >();
  for (const [canonicalId, lookbackTotal] of monthlyRunRateByCanonical) {
    const monthlyAvg = lookbackTotal / 3; // 90 días = 3 meses
    if (monthlyAvg <= 0) continue;
    const bronzeId = canonicalToBronzeMap.get(canonicalId);
    if (bronzeId == null) continue;
    if (relatedPartyIds.has(bronzeId)) continue;
    const expectedInHorizon = monthlyAvg * horizonProportion;
    const bucket1Committed = bucket1WeightedByCustomer.get(bronzeId) ?? 0;
    const bucket2Committed = bucket2WeightedByCustomer.get(bronzeId) ?? 0;
    const residualNominal = Math.max(
      0,
      expectedInHorizon - bucket1Committed - bucket2Committed
    );
    let bucket3Expected = 0;
    if (residualNominal > 0) {
      const arDelay = arDelayMap.get(bronzeId) ?? 30;
      const midpointOffset = Math.floor(horizonDays / 2);
      const orderDate = shiftDate(todayIso, midpointOffset);
      const invoiceDate = shiftDate(orderDate, CFDI_EMISSION_LAG_DAYS);
      const paymentDate = shiftDate(invoiceDate, Math.max(arDelay, 0));
      if (paymentDate <= endIso) {
        bucket3Expected = residualNominal * RUN_RATE_PROBABILITY;
        inflowByDay.set(
          paymentDate,
          (inflowByDay.get(paymentDate) ?? 0) + bucket3Expected
        );
        totalInflow += bucket3Expected;
        totalInflowNominal += residualNominal;
        addToCategory(
          "runrate_clientes",
          "Run rate (clientes activos, demanda nueva)",
          "inflow",
          bucket3Expected
        );
        pushEvent({
          date: paymentDate,
          kind: "inflow",
          amountMxn: bucket3Expected,
          nominalAmountMxn: residualNominal,
          label: "Run rate residual (cliente activo)",
          category: "runrate_clientes",
          categoryLabel: "Run rate (clientes activos, demanda nueva)",
          probability: RUN_RATE_PROBABILITY,
          companyId: bronzeId,
          counterpartyName: null,
          daysOverdue: null,
        });
      }
    }
    customerBreakdown.set(bronzeId, {
      monthlyAvg,
      expectedHorizon: expectedInHorizon,
      bucket3Expected,
    });
  }

  // Resolver display_name de TODAS las counterparties referenciadas:
  // top customers (breakdownIds) + counterparties de eventos (AR, AP, SO).
  // Sirve para la tabla de breakdown UI y para los nombres en la timeline
  // expandida (drill-down de cada evento).
  const breakdownIds = [...customerBreakdown.keys()];
  const eventCompanyIds = new Set<number>();
  for (const ev of events) {
    if (ev.companyId != null) eventCompanyIds.add(ev.companyId);
  }
  const allNameIds = new Set<number>([...breakdownIds, ...eventCompanyIds]);
  const customerNames = new Map<number, string>();
  if (allNameIds.size > 0) {
    const ids = [...allNameIds];
    // Chunk para evitar URLs gigantes con .in()
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data: nameRows } = await sb
        .from("companies")
        .select("id, name")
        .in("id", chunk);
      for (const r of (nameRows ?? []) as Array<{
        id: number | null;
        name: string | null;
      }>) {
        if (r.id != null) customerNames.set(r.id, r.name ?? `#${r.id}`);
      }
    }
  }
  // Construir tabla — incluir clientes con expectedHorizon ≥ 50k para evitar
  // ruido. Ordenar por totalExpected descendente.
  const customerInflowBreakdown: CustomerCashflowRow[] = [];
  const BREAKDOWN_MIN_EXPECTED = 50_000;
  for (const [bronzeId, data] of customerBreakdown) {
    if (data.expectedHorizon < BREAKDOWN_MIN_EXPECTED) continue;
    const bucket1 = bucket1WeightedByCustomer.get(bronzeId) ?? 0;
    const bucket2 = bucket2WeightedByCustomer.get(bronzeId) ?? 0;
    const totalExpected = bucket1 + bucket2 + data.bucket3Expected;
    const saturation =
      data.expectedHorizon > 0
        ? Math.round(((bucket1 + bucket2) / data.expectedHorizon) * 1000) / 10
        : null;
    customerInflowBreakdown.push({
      customerId: bronzeId,
      customerName: customerNames.get(bronzeId) ?? `#${bronzeId}`,
      monthlyAvgMxn: Math.round(data.monthlyAvg),
      expectedInHorizonMxn: Math.round(data.expectedHorizon),
      bucket1WeightedMxn: Math.round(bucket1),
      bucket2WeightedMxn: Math.round(bucket2),
      bucket3ExpectedMxn: Math.round(data.bucket3Expected),
      totalExpectedMxn: Math.round(totalExpected),
      saturationPct: saturation,
    });
  }
  customerInflowBreakdown.sort((a, b) => b.totalExpectedMxn - a.totalExpectedMxn);

  // ── Nómina client-side (reemplaza categoría 'nomina' del RPC) ────────
  // Best practices Quimibond:
  //  1. Excluir cuentas one-off del promedio:
  //     - 501.06.0014 AYUDA DE REYES (anual, solo enero)
  //     - 501.06.0019 INDEMNIZACION (esporádico)
  //     - 501.06.0025 PRIMA DE ANTIGUEDAD (anual o por separación)
  //     - 602.17 PRIMA DE ANTIGUEDAD (idem)
  //  2. Usar MEDIANA en últimos 6 meses (vs promedio: robusta a outliers).
  //  3. Componentes con calendario propio:
  //     - Aguinaldo (501.06.0006 + 602.12 + 603.12) → solo diciembre
  //     - Vales despensa (501.06.0010 + 602.15 + 603.15) → 1 vez/mes (día 15)
  //     - Fondo ahorro (501.06.0009 + 602.19 + 603.19) → 1 vez/mes (día último)
  //     - Resto (sueldos, premios, vacaciones, prima vacacional) → 50/50 quincenas
  //  4. Provisión aguinaldo: 1/12 del salario base proyectado para diciembre
  //     (Quimibond no provisiona mensual: balance .0006 ≈ $5k/mes solamente).
  type NominaRow = {
    period: string | null;
    account_code: string | null;
    balance: number | null;
  };
  const nominaRows = (nominaBalancesRes.data ?? []) as NominaRow[];

  const ONE_OFF_CODES = new Set([
    "501.06.0014", // Ayuda de Reyes
    "501.06.0019", // Indemnización
    "501.06.0025", // Prima de antigüedad (501)
  ]);
  const isOneOff = (code: string): boolean => {
    if (ONE_OFF_CODES.has(code)) return true;
    // 602.17.* y 603.17.* son prima de antigüedad esporádica
    if (code.startsWith("602.17.") || code.startsWith("603.17.")) return true;
    return false;
  };
  const isAguinaldo = (code: string): boolean => {
    if (code === "501.06.0006") return true;
    return code.startsWith("602.12.") || code.startsWith("603.12.");
  };
  const isValesDespensa = (code: string): boolean => {
    if (code === "501.06.0010") return true;
    return code.startsWith("602.15.") || code.startsWith("603.15.");
  };
  const isFondoAhorro = (code: string): boolean => {
    if (code === "501.06.0009") return true;
    return code.startsWith("602.19.") || code.startsWith("603.19.");
  };
  // Validar que el code aplique al filtro del RPC (501.06 sin 0020-23, ó
  // 602.01-25, ó 603.01-25). Defensa por si el .or de PostgREST trae algo
  // fuera de scope.
  const isInNominaScope = (code: string): boolean => {
    if (code.startsWith("501.06.")) {
      if (code.startsWith("501.06.0020") || code.startsWith("501.06.0021") ||
          code.startsWith("501.06.0022") || code.startsWith("501.06.0023")) {
        return false;
      }
      return true;
    }
    const parts = code.split(".");
    if (parts.length < 2) return false;
    if (parts[0] === "602" || parts[0] === "603") {
      const n = parseInt(parts[1], 10);
      return Number.isFinite(n) && n >= 1 && n <= 25;
    }
    return false;
  };

  // Sumar por período + categoría (excluyendo one-offs)
  type NominaPeriodTotals = {
    period: string;
    sueldos: number; // todo lo regular quincenal
    valesDespensa: number;
    fondoAhorro: number;
    aguinaldo: number;
  };
  const nominaByPeriod = new Map<string, NominaPeriodTotals>();
  for (const r of nominaRows) {
    if (!r.period || !r.account_code) continue;
    const code = r.account_code;
    if (!isInNominaScope(code)) continue;
    if (isOneOff(code)) continue;
    const bal = Number(r.balance) || 0;
    if (bal === 0) continue;
    const acc = nominaByPeriod.get(r.period) ?? {
      period: r.period,
      sueldos: 0,
      valesDespensa: 0,
      fondoAhorro: 0,
      aguinaldo: 0,
    };
    if (isAguinaldo(code)) acc.aguinaldo += bal;
    else if (isValesDespensa(code)) acc.valesDespensa += bal;
    else if (isFondoAhorro(code)) acc.fondoAhorro += bal;
    else acc.sueldos += bal;
    nominaByPeriod.set(r.period, acc);
  }

  const median = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const periodValues = [...nominaByPeriod.values()];
  const sueldosMedian = median(periodValues.map((p) => p.sueldos));
  const valesMedian = median(periodValues.map((p) => p.valesDespensa));
  const fondoMedian = median(periodValues.map((p) => p.fondoAhorro));
  // Aguinaldo provisión = sueldos × 0.041 (15 días salario / 365 días).
  // Quimibond no provisiona mensual; el cash hit cae en diciembre.
  // Estimamos como (sueldos_anual × 15/365) y proyectamos para el día 20 dic.
  const aguinaldoAnnualEstimate = sueldosMedian * 12 * (15 / 365);

  const monthsInHorizon = (() => {
    const months: Array<{ year: number; month: number; firstDay: Date; lastDay: Date }> = [];
    const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cursor <= endDate) {
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      months.push({
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
        firstDay: new Date(cursor),
        lastDay,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  })();

  const pushNominaInflow = (
    iso: string,
    amount: number,
    label: string,
    sublabel: string
  ) => {
    if (amount <= 0) return;
    if (iso > endIso) return;
    if (iso < todayIso) return; // ya pasó, asumir pagado
    outflowByDay.set(iso, (outflowByDay.get(iso) ?? 0) + amount);
    totalOutflow += amount;
    addToCategory("nomina", "Nómina y prestaciones", "outflow", amount);
    pushEvent({
      date: iso,
      kind: "outflow",
      amountMxn: amount,
      nominalAmountMxn: amount,
      label: `${label} · ${sublabel}`,
      category: "nomina",
      categoryLabel: "Nómina y prestaciones",
      probability: null,
      companyId: null,
      counterpartyName: null,
      daysOverdue: null,
    });
  };

  for (const m of monthsInHorizon) {
    const yyyymm = `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
    // Sueldos quincenales: día 15 + último día. Splitting median/2.
    const day15 = new Date(m.year, m.month, 15);
    const day15Iso = toIso(day15);
    const lastIso = toIso(m.lastDay);
    pushNominaInflow(day15Iso, sueldosMedian / 2, "Sueldos quincena 15", yyyymm);
    pushNominaInflow(lastIso, sueldosMedian / 2, "Sueldos quincena fin", yyyymm);
    // Vales despensa: día 15 (1 vez/mes, junto con la primera quincena)
    pushNominaInflow(day15Iso, valesMedian, "Vales de despensa", yyyymm);
    // Fondo ahorro: último día del mes
    pushNominaInflow(lastIso, fondoMedian, "Fondo de ahorro", yyyymm);
    // Aguinaldo: solo diciembre (día 20)
    if (m.month === 11) {
      const dec20 = toIso(new Date(m.year, 11, 20));
      pushNominaInflow(dec20, aguinaldoAnnualEstimate, "Aguinaldo (anual)", yyyymm);
    }
  }

  // Procesar recurring flows del RPC silver (nómina, renta, servicios,
  // arrendamiento). NOTA: ventas_proyectadas se SKIPEA aquí porque ya está
  // cubierto por la capa 3 client-level (run rate per customer descontando
  // bucket 1+2). El recurring global ventas_proyectadas era un proxy
  // statistical que duplicaba.
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
  // Categorías reemplazadas por modelos más precisos en este file:
  //  - ventas_proyectadas → reemplazado por capa 3 (run rate per customer
  //    descontando bucket 1+2). El recurring global era un proxy statistical
  //    que duplicaba con el AR ya en cashflow_projection.
  // 'nomina' también reemplazada — calculada client-side arriba con
  // exclusión de one-offs (Reyes, indemnización, prima antigüedad),
  // mediana en lugar de promedio, calendario propio por componente
  // (sueldos quincenales, vales mensual día 15, fondo ahorro último día,
  // aguinaldo anual diciembre 20).
  const REPLACED_CATS = new Set(["ventas_proyectadas", "nomina"]);
  const recRows = (recurringRes.data ?? []) as RecRow[];
  for (const r of recRows) {
    if (REPLACED_CATS.has(r.category)) continue;
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
      pushEvent({
        date,
        kind: "inflow",
        amountMxn: amount,
        nominalAmountMxn: amount,
        label: r.category_label,
        category: r.category,
        categoryLabel: r.category_label,
        probability: r.probability == null ? null : Number(r.probability),
        companyId: null,
        counterpartyName: null,
        daysOverdue: null,
      });
    } else {
      outflowByDay.set(date, (outflowByDay.get(date) ?? 0) + amount);
      totalOutflow += amount;
      addToCategory(r.category, r.category_label, "outflow", amount);
      pushEvent({
        date,
        kind: "outflow",
        amountMxn: amount,
        nominalAmountMxn: amount,
        label: r.category_label,
        category: r.category,
        categoryLabel: r.category_label,
        probability: r.probability == null ? null : Number(r.probability),
        companyId: null,
        counterpartyName: null,
        daysOverdue: null,
      });
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
    events: events.map((e) => ({
      ...e,
      counterpartyName:
        e.counterpartyName ??
        (e.companyId != null ? customerNames.get(e.companyId) ?? null : null),
    })),
    categoryTotals,
    customerInflowBreakdown,
  };
}

export const getCashProjection = unstable_cache(
  _getCashProjectionRaw,
  ["sp13-finanzas-cash-projection-v15-nomina-detail"],
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
