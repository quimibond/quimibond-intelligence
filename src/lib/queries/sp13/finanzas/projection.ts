import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import {
  getLearnedAgingCalibration,
  getLearnedCounterpartyParams,
  getLearnedHistoricalRecurrence,
} from "./learned-params";

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
 * Modelo SIMÉTRICO de tres capas:
 *
 * INFLOWS (sin duplicación):
 *   1. AR ya facturado (cashflow_projection.receivable_detail) — con IVA
 *   2. SO confirmadas pero no facturadas — con IVA via tax factor
 *   3. Run rate per cliente activo (last 90d / 3 = monthly avg con IVA),
 *      descontando bucket 1+2 weighted en horizonte. Probabilidad por
 *      tier de recurrencia: 3+ meses activos=0.70, 2 meses=0.35, 1 mes=skip
 *      (one-off, no se proyecta). Reemplaza `ventas_proyectadas` del RPC.
 *
 * OUTFLOWS (sin duplicación):
 *   1. AP ya facturado (cashflow_projection.payable_detail)
 *   2. Recurrentes calendarizados (nómina semanal+quincenal con CFDIs SAT,
 *      renta día 1, servicios día 10, arrendamiento día 5, impuestos SAT
 *      día 17, aguinaldo 20-dic)
 *   3. Run rate per proveedor activo (last 90d / 3 = monthly avg con IVA),
 *      descontando bucket 1 (apCommittedBySupplier) en horizonte.
 *      Probabilidad por tier de recurrencia: 3+ meses=0.80, 2 meses=0.40,
 *      1 mes=skip (excluye one-offs como compras grandes únicas que no
 *      se repiten — ej. ICOMATEX $12.5M en marzo).
 *      Categoría 'runrate_proveedores'.
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
  // Stale cuando algun banco con classification=cash tiene is_stale=true
  // (updated_at > 48h). UI deberia mostrar badge "saldo bancario stale".
  // Audit 2026-04-27 finding #11.
  openingBalanceStale: boolean;
  openingBalanceStaleHours: number;
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
  // Metadata de auto-aprendizaje. Permite al CEO ver qué tan entrenado
  // está el modelo y la calibración empírica vs heurísticas.
  learning: {
    canonicalSampleSize: number; // # facturas issued ≥180d con outcome
    canonicalCounterparties: number; // # bronze ids con learned params (12m)
    satCounterparties: number; // # bronze ids con SAT history (60m)
    satOldestRecord: string;
    freshPaymentRate: number; // tasa empírica vs heurística 0.95
    freshHeuristicRate: number; // 0.95
    asOfDate: string;
  };
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

  // Lookback nómina: últimos 6 meses cerrados. Extraído de CFDIs SAT
  // (syntage_invoices tipo 'N') para reflejar el cash real al empleado
  // y separar cohortes semanal vs quincenal por patrón de fechas.
  const nominaLookbackFromMonth = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 6, 1);
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
    nominaCfdiRes,
    classifRes,
  ] = await Promise.all([
      sb
        .from("canonical_bank_balances")
        .select("classification, current_balance_mxn, is_stale, updated_at"),
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
      // CFDIs de nómina (tipo "N", direction='issued') últimos 6 meses.
      // Source de truth para el cash flow real al empleado:
      //   - Subtotal CFDI = bruto devengado (incluye retenciones).
      //   - Total CFDI = NETO al empleado (lo que sale del banco).
      //   - Las retenciones (ISR, IMSS empleado) se enteran al SAT día 17
      //     mes siguiente — ya están en `impuestos_sat` del recurring RPC.
      //   - Quimibond tiene 99 empleados semanales (CFDIs cada ~7d, los
      //     viernes) + 65 quincenales (CFDIs días 15 + último).
      // Usar TOTAL evita double count con impuestos_sat (que ya proyecta
      // las retenciones separadas).
      sb
        .from("syntage_invoices")
        .select("fecha_emision, total_mxn, subtotal")
        .eq("tipo_comprobante", "N")
        .eq("direction", "issued")
        .neq("estado_sat", "cancelado")
        .gte("fecha_emision", `${nominaLookbackFromMonth}-01`)
        .gt("total_mxn", 0),
      // Counterparty classification (counterparty_type + customer_lifecycle).
      // Solo cargar las que tienen clasificación no-default — ahorra
      // ~70% de rows. Las que no aparecen quedan default (operativo+active).
      // Migration 20260427_counterparty_classification.sql.
      sb
        .from("canonical_companies")
        .select("id, odoo_partner_id, counterparty_type, customer_lifecycle")
        .or("counterparty_type.neq.operativo,customer_lifecycle.neq.active")
        .not("odoo_partner_id", "is", null),
    ]);

  // Capa 3: run rate por cliente activo. Pulled separately después del
  // primer batch para no cargar el Promise.all con dependencias cruzadas.
  // Tomamos los últimos 90 días de canonical_invoices issued con IVA
  // (amount_total_mxn_resolved) — es el cash que el cliente NOS paga.
  const customerLookbackIso = toIso(new Date(today.getTime() - 90 * 86400000));
  // Parámetros aprendidos del histórico (cached separadamente, refresh 1h):
  //   - agingCalibration: tasas reales de cobro por bucket (calibran las
  //     heurísticas 95/85/70/50/25 vs lo que realmente pasa en Quimibond)
  //   - learnedCounterpartyParams: 12m precise (canonical_invoices)
  //   - learnedHistoricalRecurrence: 60m SAT (multi-year recurrence,
  //     antigüedad, estacionalidad)
  const [agingCalibration, learnedCounterparty, learnedHistorical] =
    await Promise.all([
      getLearnedAgingCalibration(),
      getLearnedCounterpartyParams(),
      getLearnedHistoricalRecurrence(),
    ]);
  const freshPaymentRate =
    agingCalibration.paymentRateByBucket.fresh.rate || 0.95;

  const [customerInvRes, supplierInvRes] = await Promise.all([
    sb
      .from("canonical_invoices")
      .select(
        "receptor_canonical_company_id, amount_total_mxn_resolved, invoice_date"
      )
      .eq("direction", "issued")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gte("invoice_date", customerLookbackIso)
      .gt("amount_total_mxn_resolved", 0),
    // Idéntico para proveedores: run rate de COMPRAS nuevas esperadas.
    // Sin esto, el modelo era asimétrico (3 capas de inflow vs 2 de
    // outflow) y subestimaba los outflows porque solo proyectaba AP
    // existente + recurrentes. La realidad: la empresa va a recibir
    // facturas NUEVAS de proveedores en el horizonte que aún no están
    // registradas hoy.
    sb
      .from("canonical_invoices")
      .select(
        "emisor_canonical_company_id, amount_total_mxn_resolved, invoice_date"
      )
      .eq("direction", "received")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gte("invoice_date", customerLookbackIso)
      .gt("amount_total_mxn_resolved", 0),
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

  // Map Bronze company.id → { counterpartyType, lifecycle }.
  // canonical_companies.odoo_partner_id ↔ companies.odoo_partner_id ↔ companies.id.
  // Default (no entry) = operativo + active.
  type ClassRow = {
    id: number | null;
    odoo_partner_id: number | null;
    counterparty_type: string | null;
    customer_lifecycle: string | null;
  };
  const classifRows = (classifRes.data ?? []) as ClassRow[];
  const classByBronze = new Map<
    number,
    { counterpartyType: string; lifecycle: string }
  >();
  if (classifRows.length > 0) {
    const partnerIds = classifRows
      .map((c) => c.odoo_partner_id)
      .filter((p): p is number => p != null);
    if (partnerIds.length > 0) {
      const { data: bronzeMap } = await sb
        .from("companies")
        .select("id, odoo_partner_id")
        .in("odoo_partner_id", partnerIds);
      const partnerToBronze = new Map<number, number>();
      for (const b of (bronzeMap ?? []) as Array<{
        id: number | null;
        odoo_partner_id: number | null;
      }>) {
        if (b.id != null && b.odoo_partner_id != null) {
          partnerToBronze.set(b.odoo_partner_id, b.id);
        }
      }
      for (const c of classifRows) {
        if (c.odoo_partner_id == null) continue;
        const bronzeId = partnerToBronze.get(c.odoo_partner_id);
        if (bronzeId != null) {
          classByBronze.set(bronzeId, {
            counterpartyType: c.counterparty_type ?? "operativo",
            lifecycle: c.customer_lifecycle ?? "active",
          });
        }
      }
    }
  }
  const getClass = (bronzeId: number | null) =>
    bronzeId == null ? null : classByBronze.get(bronzeId) ?? null;
  const isLost = (bronzeId: number | null) =>
    getClass(bronzeId)?.lifecycle === "lost";
  // Excluir de SO pipeline (capa 2): financiera/blacklisted como type, o
  // lifecycle marcado lost/dormant. Decisión CEO 2026-04-27.
  // NOTA: intercom NO se excluye en capa 2 — facturas intercom donde
  // Quimibond es contraparte son cash real (consistente con capa 1).
  const isExcludedFromSoPipeline = (bronzeId: number | null) => {
    const c = getClass(bronzeId);
    if (!c) return false;
    if (c.counterpartyType === "financiera" || c.counterpartyType === "blacklisted")
      return true;
    if (c.lifecycle === "lost" || c.lifecycle === "dormant") return true;
    return false;
  };
  // Excluir de RUN RATE (capa 3): cualquier counterparty_type no-operativo
  // (intercom, financiera, gobierno, utility, one_off, blacklisted) o
  // lifecycle no-active/at_risk (lost, dormant, prospect). El run rate
  // es proyección especulativa de demanda futura — solo aplicamos a
  // clientes/proveedores activos genuinos.
  const isExcludedFromRunRate = (bronzeId: number | null) => {
    const c = getClass(bronzeId);
    if (!c) return false;
    if (c.counterpartyType !== "operativo") return true;
    if (c.lifecycle !== "active" && c.lifecycle !== "at_risk") return true;
    return false;
  };

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

  type Bank = {
    classification: string | null;
    current_balance_mxn: number | null;
    is_stale: boolean | null;
    updated_at: string | null;
  };
  const banks = (cashRes.data ?? []) as Bank[];
  const cashBanks = banks.filter((b) => b.classification === "cash");
  const opening = cashBanks.reduce(
    (s, b) => s + (Number(b.current_balance_mxn) || 0),
    0
  );

  // Audit 2026-04-27 finding #11. canonical_bank_balances.is_stale=true
  // cuando updated_at > 48h. Si Belvo cae, opening balance es snapshot
  // viejo y el resto del chart suma sobre un punto inicial obsoleto.
  // Surfacing la condicion deja al usuario decidir si confiar.
  const openingBalanceStale = cashBanks.some((b) => b.is_stale === true);
  const openingBalanceStaleHours = cashBanks.reduce((max, b) => {
    if (!b.updated_at) return max;
    const ageMs = today.getTime() - new Date(b.updated_at).getTime();
    if (ageMs <= 0) return max;
    const hours = ageMs / 3_600_000;
    return hours > max ? hours : max;
  }, 0);

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

  // Filtro defensivo `payment_state_odoo='in_payment'`: la matview
  // cashflow_projection es legacy aplicada vía MCP y a veces incluye
  // facturas en estado `in_payment` (ya conciliadas con el banco pero
  // pendientes de booking final en Odoo). Si las dejamos pasar, se
  // doble-cuentan con canonical_payments en el horizonte 0-14d.
  // Audit 2026-04-27 finding #10. Cuando exista paridad SQL para la
  // matview (audit finding #1), mover este filtro a su definición.
  const projInvoiceNames = Array.from(
    new Set(
      projRows
        .map((r) => r.invoice_name)
        .filter((n): n is string => typeof n === "string" && n.length > 0)
    )
  );
  const inPaymentNames = new Set<string>();
  // Audit 2026-04-27 finding #16: canonical_credit_notes (NCs) descontadas
  // del AR/AP billed. Si el cliente emite/recibe una NC contra una factura
  // abierta, el `amount_residual` de cashflow_projection no siempre la
  // refleja (especialmente NCs solo-SAT no reconciliadas en Odoo).
  // Construimos un mapa odoo_name → total_credit_amount para subtraer en
  // el loop principal.
  const creditByInvoiceName = new Map<string, number>();
  if (projInvoiceNames.length > 0) {
    const chunkSize = 1000;
    // Bridge: odoo_name → canonical_id desde canonical_invoices.
    const nameToCanonical = new Map<string, string>();
    const canonicalToName = new Map<string, string>();
    for (let i = 0; i < projInvoiceNames.length; i += chunkSize) {
      const chunk = projInvoiceNames.slice(i, i + chunkSize);
      const { data: invs } = await sb
        .from("canonical_invoices")
        .select("canonical_id, odoo_name, payment_state_odoo")
        .in("odoo_name", chunk);
      for (const row of (invs ?? []) as Array<{
        canonical_id: string | null;
        odoo_name: string | null;
        payment_state_odoo: string | null;
      }>) {
        if (!row.odoo_name) continue;
        if (row.payment_state_odoo === "in_payment") inPaymentNames.add(row.odoo_name);
        if (row.canonical_id) {
          nameToCanonical.set(row.odoo_name, row.canonical_id);
          canonicalToName.set(row.canonical_id, row.odoo_name);
        }
      }
    }
    // NCs ligadas a las facturas en horizonte. is_quimibond_relevant=true y
    // estado_sat <> cancelado para excluir NCs canceladas o personales.
    const canonicalIds = Array.from(nameToCanonical.values());
    if (canonicalIds.length > 0) {
      for (let i = 0; i < canonicalIds.length; i += chunkSize) {
        const chunk = canonicalIds.slice(i, i + chunkSize);
        const { data: ncs } = await sb
          .from("canonical_credit_notes")
          .select("related_invoice_canonical_id, amount_total_mxn_resolved, estado_sat, is_quimibond_relevant")
          .in("related_invoice_canonical_id", chunk)
          .eq("is_quimibond_relevant", true);
        for (const nc of (ncs ?? []) as Array<{
          related_invoice_canonical_id: string | null;
          amount_total_mxn_resolved: number | null;
          estado_sat: string | null;
          is_quimibond_relevant: boolean | null;
        }>) {
          if (!nc.related_invoice_canonical_id) continue;
          if (nc.estado_sat === "cancelado") continue;
          const amount = Number(nc.amount_total_mxn_resolved) || 0;
          if (amount <= 0) continue;
          const invName = canonicalToName.get(nc.related_invoice_canonical_id);
          if (!invName) continue;
          creditByInvoiceName.set(
            invName,
            (creditByInvoiceName.get(invName) ?? 0) + amount
          );
        }
      }
    }
  }

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
  // Idem para AP por proveedor (egreso de facturas ya recibidas).
  // Usado para descontar al run rate de compras y evitar duplicar.
  const apCommittedBySupplier = new Map<number, number>();

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

  // Audit 2026-04-27 finding #9: aging probability per cliente con
  // shrinkage hacia el global. Override del expected_amount del matview
  // (que usa heurísticas hardcoded 95/85/70/50/25) cuando tenemos
  // histórico suficiente del cliente.
  const perCustAging = agingCalibration.perCustomerByBronzeId;
  const pickPersonalizedRate = (
    customerId: number | null,
    daysOverdue: number | null
  ): number | null => {
    if (customerId == null) return null;
    const rates = perCustAging.get(customerId);
    if (!rates) return null;
    const od = daysOverdue ?? 0;
    if (od <= 0) return rates.fresh;
    if (od <= 30) return rates.overdue_1_30;
    if (od <= 60) return rates.overdue_31_60;
    if (od <= 90) return rates.overdue_61_90;
    return rates.overdue_90_plus;
  };

  for (const r of projRows) {
    const origDate = r.projected_date;
    if (!origDate) continue;
    if (r.invoice_name && inPaymentNames.has(r.invoice_name)) continue;
    const isInflow = r.flow_type === "receivable_detail";
    let nominal = Number(r.amount_residual) || 0;
    let expected = Number(r.expected_amount ?? r.amount_residual) || 0;
    // Audit 2026-04-27 finding #16: descontar NCs ligadas a esta factura.
    // amount_residual del matview no siempre las refleja (NCs SAT-only).
    // Cap a 0 — una NC > residual deja la factura efectivamente cancelada.
    const creditAmount = r.invoice_name
      ? creditByInvoiceName.get(r.invoice_name) ?? 0
      : 0;
    if (creditAmount > 0) {
      const ratio = nominal > 0 ? Math.max(0, (nominal - creditAmount) / nominal) : 0;
      nominal = Math.max(0, nominal - creditAmount);
      expected = expected * ratio;
    }
    if (expected <= 0) continue;

    // Audit #9: si el cliente tiene histórico, override expected con su
    // rate personalizado (shrinked al global). Solo AR — AP es 1.0 always.
    if (isInflow) {
      const personalRate = pickPersonalizedRate(r.company_id, r.days_overdue);
      if (personalRate != null && nominal > 0) {
        expected = nominal * personalRate;
        if (expected <= 0) continue;
      }
    }

    // Capa 1 lifecycle filter: lost customers → expected × 0.05.
    // Mantén la factura visible (es cobro legalmente exigible) pero
    // realista del cash que va a entrar. Solo aplica a inflows (AR);
    // AP a proveedores no se ajusta por lifecycle (debemos lo que
    // debemos sin importar su status comercial).
    if (isInflow && isLost(r.company_id)) {
      expected = expected * 0.05;
      if (expected <= 0) continue;
    }

    // Las facturas intercompañía donde Quimibond es la contraparte
    // (emisor o receptor) son cash flow real — se tratan como AR/AP
    // normal. cashflow_projection solo contiene rows con Quimibond
    // involucrado, así que no hay riesgo de incluir flujos entre
    // partes relacionadas que no nos involucren.
    //
    // Nota histórica: antes había push 180d preventivo por el préstamo
    // accionista de $12.81M en 205.04 (CLAUDE.md). Pero ese vive a
    // nivel GL, no como factura — no afecta cashflow_projection. Si
    // en el futuro emiten factura intercompañía, ya entra como cash
    // real (es real). Decisión CEO 2026-04-27.
    const invoiceKey =
      r.invoice_name ?? `${r.flow_type}-${r.company_id}-${origDate}-${nominal}`;
    let date = origDate;
    let delayForSpread = 0;
    if (r.company_id != null) {
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
    date = spreadPastDue(date, delayForSpread, invoiceKey);

    if (isInflow) {
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
    } else {
      outflowByDay.set(date, (outflowByDay.get(date) ?? 0) + nominal);
      totalOutflow += nominal;
      addToCategory(
        "ap_proveedores",
        "AP a proveedores (factura recibida)",
        "outflow",
        nominal
      );
      if (r.company_id != null && date <= endIso) {
        apCommittedBySupplier.set(
          r.company_id,
          (apCommittedBySupplier.get(r.company_id) ?? 0) + nominal
        );
      }
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
    if (amtForMarker >= MARKER_THRESHOLD) {
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
    // Capa 2 filter: excluir SOs de financiera/blacklisted (no son
    // clientes de producto), o de clientes lost/dormant (no van a
    // pagar). Intercom NO se excluye — es Quimibond cobrándose a sí
    // misma, cash real (consistente con capa 1). Decisión CEO 2026-04-27.
    if (isExcludedFromSoPipeline(header.company_id)) {
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

  // Run rate mensual por cliente: SUM(invoiced last 90d con IVA) / 3.
  // Track también # distinct months para clasificar recurrencia y aplicar
  // probabilidad por tier (recurrente fuerte vs débil vs one-off).
  //
  // Audit 2026-04-27 finding #7: cap cada invoice a 2× la mediana del
  // cliente para evitar que outliers (cierres de año, pedidos atípicos,
  // facturas grandes one-off) inflen el run rate. Preserves la señal
  // central — solo recorta el extremo superior. Cap solo aplica si el
  // cliente tiene >=4 facturas en el window; con menos, no hay base
  // estadística para identificar outlier.
  const invoicesByCustomer = new Map<number, number[]>();
  for (const r of customerInvRows) {
    const cid = r.receptor_canonical_company_id;
    if (cid == null) continue;
    const amt = Number(r.amount_total_mxn_resolved) || 0;
    if (amt <= 0) continue;
    const arr = invoicesByCustomer.get(cid) ?? [];
    arr.push(amt);
    invoicesByCustomer.set(cid, arr);
  }
  const median = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };
  const monthlyRunRateByCanonical = new Map<number, number>();
  const customerActiveMonths = new Map<number, Set<string>>();
  for (const r of customerInvRows) {
    const cid = r.receptor_canonical_company_id;
    if (cid == null) continue;
    let amt = Number(r.amount_total_mxn_resolved) || 0;
    const arr = invoicesByCustomer.get(cid) ?? [];
    if (arr.length >= 4) {
      const med = median(arr);
      if (med > 0) amt = Math.min(amt, med * 2);
    }
    monthlyRunRateByCanonical.set(
      cid,
      (monthlyRunRateByCanonical.get(cid) ?? 0) + amt
    );
    if (r.invoice_date) {
      const month = r.invoice_date.slice(0, 7);
      const set = customerActiveMonths.get(cid) ?? new Set<string>();
      set.add(month);
      customerActiveMonths.set(cid, set);
    }
  }
  // Probabilidad por tier de recurrencia × calibración empírica (clientes).
  // Tiers basados en months activos sobre 12m (no 3m, más estable):
  //   ≥9 meses (casi todos):  0.90 × calibration
  //   6-8 meses:              0.75 × calibration
  //   3-5 meses:              0.55 × calibration
  //   2 meses:                0.30 × calibration
  //   1 mes:                  skip (one-off, no proyectar)
  // calibration = freshPaymentRate empírico (typically <0.95 por morosidad
  // estructural Quimibond — refleja realidad).
  const probabilityForCustomerRecurrence = (
    months12: number,
    freshRate: number
  ): number => {
    let base = 0;
    if (months12 >= 9) base = 0.9;
    else if (months12 >= 6) base = 0.75;
    else if (months12 >= 3) base = 0.55;
    else if (months12 === 2) base = 0.3;
    else return 0;
    return base * Math.max(0.5, Math.min(1.0, freshRate));
  };
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
    // Capa 3 filter: solo operativo + active/at_risk. Excluye intercom,
    // financiera, gobierno, utility, one_off, blacklisted, lost, dormant,
    // prospect. Run rate es proyección especulativa de demanda futura —
    // solo aplicar a clientes operativos genuinamente activos.
    if (isExcludedFromRunRate(bronzeId)) continue;
    const canonicalActive3m = customerActiveMonths.get(canonicalId)?.size ?? 0;
    // Capa de aprendizaje: combinar canonical (12m precise) + SAT (24m
    // long-term). El signal más fuerte gana — un cliente puede ser
    // "one-off" en 3m pero "recurrente long-term" en SAT 24m.
    const learnedCp = learnedCounterparty.byBronzeId.get(bronzeId);
    const learnedSat = learnedHistorical.byBronzeId.get(bronzeId);
    const canonicalActive12m = learnedCp?.activeMonthsLast12 ?? canonicalActive3m;
    const satActive24m = learnedSat?.activeMonthsLast24 ?? 0;
    // Normalizar SAT 24m → equivalente 12m dividiendo entre 2
    const effectiveActive12m = Math.max(
      canonicalActive12m,
      Math.round(satActive24m / 2)
    );
    // Calibración empírica: usar la tasa REAL de cobro fresh observada
    // en últimos 18m de Quimibond (vs heurística asumida 0.95).
    const customerProb = probabilityForCustomerRecurrence(effectiveActive12m, freshPaymentRate);
    // Trend factor: si cliente está creciendo (recent3m/prior9m > 1),
    // ajustar monthlyAvg para reflejar la tendencia.
    const trendFactor = learnedCp?.trendFactor ?? 1.0;
    // Seasonality: si cliente histórico vende ~1.4x en Q4 y el horizonte
    // cae sobre Q4, ajustar al alza. Calculamos como avg de las
    // seasonalityByMonth para los meses en el horizonte (cap [0.5, 2.0]).
    const sat = learnedSat;
    let seasonalityFactor = 1.0;
    if (sat?.seasonalityByMonth && sat.seasonalityByMonth.length === 13) {
      const cursor = new Date(today);
      const factors: number[] = [];
      while (cursor <= endDate) {
        const moy = cursor.getMonth() + 1;
        factors.push(sat.seasonalityByMonth[moy] ?? 1.0);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      if (factors.length > 0) {
        const avg = factors.reduce((s, f) => s + f, 0) / factors.length;
        seasonalityFactor = Math.max(0.5, Math.min(2.0, avg));
      }
    }
    const monthlyAvgAdjusted = monthlyAvg * trendFactor * seasonalityFactor;
    if (customerProb <= 0) {
      // One-off customer (1 mes activo): NO proyectar como recurrente.
      // Su AR ya facturado sigue en bucket 1; aquí solo descartamos
      // proyectar nuevas compras esperadas que no se van a repetir.
      customerBreakdown.set(bronzeId, {
        monthlyAvg,
        expectedHorizon: monthlyAvg * horizonProportion,
        bucket3Expected: 0,
      });
      continue;
    }
    const expectedInHorizon = monthlyAvgAdjusted * horizonProportion;
    const bucket1Committed = bucket1WeightedByCustomer.get(bronzeId) ?? 0;
    const bucket2Committed = bucket2WeightedByCustomer.get(bronzeId) ?? 0;
    const residualNominal = Math.max(
      0,
      expectedInHorizon - bucket1Committed - bucket2Committed
    );
    let bucket3Expected = 0;
    if (residualNominal > 0) {
      // Preferir learned median delay (12m sample) sobre RPC silver (6m).
      // Más estable cuando hay menos volumen mensual.
      const arDelay =
        learnedCp?.medianDelayDays != null && learnedCp.paymentSampleSize >= 5
          ? learnedCp.medianDelayDays
          : arDelayMap.get(bronzeId) ?? 30;
      // Distribuir el residual SEMANALMENTE sobre el horizonte (no
      // concentrar en midpoint+delay, que apilaba 50+ clientes en una
      // misma fecha generando pico artificial). El cliente típicamente
      // coloca varias órdenes a lo largo del horizonte y cobra en
      // cadencia ~semanal. Modelo:
      //   - Primer cobro = today + ar_delay + dayOffset (0-6 stable hash
      //     del bronzeId) → cada cliente cae en día distinto de la semana,
      //     evita que todos los clientes con mismo delay se apilen.
      //   - Subsecuentes = cada 7 días hasta endDate
      //   - Monto por cobro = residual_weighted / # cobros caben
      const dayOffset = stableHash(`runrate-${bronzeId}`) % 7;
      const firstPayDate = shiftDate(todayIso, arDelay + dayOffset);
      // Generar fechas de pago semanales dentro del horizonte
      const paymentDates: string[] = [];
      const cursor = new Date(firstPayDate);
      while (cursor <= endDate) {
        paymentDates.push(toIso(cursor));
        cursor.setDate(cursor.getDate() + 7);
      }
      if (paymentDates.length === 0) {
        // ar_delay > horizonte → todo el residual cae fuera; ignorar.
        bucket3Expected = 0;
      } else {
        const weightedTotal = residualNominal * customerProb;
        const perPayment = weightedTotal / paymentDates.length;
        const nominalPerPayment = residualNominal / paymentDates.length;
        bucket3Expected = weightedTotal;
        totalInflow += weightedTotal;
        totalInflowNominal += residualNominal;
        addToCategory(
          "runrate_clientes",
          "Run rate (clientes activos, demanda nueva)",
          "inflow",
          weightedTotal
        );
        for (const payDate of paymentDates) {
          inflowByDay.set(
            payDate,
            (inflowByDay.get(payDate) ?? 0) + perPayment
          );
          pushEvent({
            date: payDate,
            kind: "inflow",
            amountMxn: perPayment,
            nominalAmountMxn: nominalPerPayment,
            label: "Run rate residual (cliente activo)",
            category: "runrate_clientes",
            categoryLabel: "Run rate (clientes activos, demanda nueva)",
            probability: customerProb,
            companyId: bronzeId,
            counterpartyName: null,
            daysOverdue: null,
          });
        }
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

  // ── Capa 3 OUTFLOW: Run rate por proveedor activo (last 90d) ──────────
  // Simétrico a la capa 3 de inflow (clientes). Para cada proveedor con
  // facturación recibida en últimos 90d, proyecta su demanda mensual
  // promedio (con IVA — total que pagamos), descontando:
  //   - AP committed (capa 1): salidas weighted en horizonte para ese
  //     proveedor que ya están en cashflow_projection.
  //   - Recurrentes ya separados (renta, servicios, arrendamiento, SAT,
  //     IMSS): NO se descuentan aquí porque viven en su propia categoría
  //     (proveedor LEPEZO sí entra al run rate, pero ya lo descontamos
  //     vía apCommittedBySupplier si tiene AP abierto).
  //
  // Probabilidad 0.80 (ligeramente mayor que clientes 0.70 — las compras
  // a proveedores son más predecibles porque hay contratos y necesidades
  // operativas constantes).
  //
  // Distribución: semanal con offset por hash del bronze id (mismo
  // algoritmo que clientes para evitar concentración artificial).
  // Usa ap_delay del proveedor para fechar el primer pago.
  type SupplierInvRow = {
    emisor_canonical_company_id: number | null;
    amount_total_mxn_resolved: number | null;
    invoice_date: string | null;
  };
  const supplierInvRows = (supplierInvRes.data ?? []) as SupplierInvRow[];

  // Resolver canonical → bronze para emisores
  const supplierCanonicalIds = new Set<number>();
  for (const r of supplierInvRows) {
    if (r.emisor_canonical_company_id != null) {
      supplierCanonicalIds.add(r.emisor_canonical_company_id);
    }
  }
  const supplierCanonicalToBronze = new Map<number, number>();
  if (supplierCanonicalIds.size > 0) {
    const ids = [...supplierCanonicalIds];
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
      const chunkSize = 200;
      for (let i = 0; i < partnerIds.length; i += chunkSize) {
        const chunk = partnerIds.slice(i, i + chunkSize);
        const { data: bronzeData } = await sb
          .from("companies")
          .select("id, odoo_partner_id")
          .in("odoo_partner_id", chunk);
        for (const b of (bronzeData ?? []) as Array<{
          id: number | null;
          odoo_partner_id: number | null;
        }>) {
          if (b.id != null && b.odoo_partner_id != null) {
            const cid = ccByPartner.get(b.odoo_partner_id);
            if (cid != null) supplierCanonicalToBronze.set(cid, b.id);
          }
        }
      }
    }
  }

  // Run rate mensual por proveedor: SUM(received last 90d con IVA) / 3.
  // Track también # distinct months para clasificar recurrencia y aplicar
  // probabilidad por tier (igual que clientes — evita inflar el outflow
  // con compras grandes one-off como ICOMATEX $12M en marzo).
  // Audit #7: misma winsorización per-proveedor que customers (cap 2× median).
  const supplierInvoicesByCanonical = new Map<number, number[]>();
  for (const r of supplierInvRows) {
    const cid = r.emisor_canonical_company_id;
    if (cid == null) continue;
    const amt = Number(r.amount_total_mxn_resolved) || 0;
    if (amt <= 0) continue;
    const arr = supplierInvoicesByCanonical.get(cid) ?? [];
    arr.push(amt);
    supplierInvoicesByCanonical.set(cid, arr);
  }
  const monthlySupplierRunRate = new Map<number, number>();
  const supplierActiveMonths = new Map<number, Set<string>>();
  for (const r of supplierInvRows) {
    const cid = r.emisor_canonical_company_id;
    if (cid == null) continue;
    let amt = Number(r.amount_total_mxn_resolved) || 0;
    const arr = supplierInvoicesByCanonical.get(cid) ?? [];
    if (arr.length >= 4) {
      const med = median(arr);
      if (med > 0) amt = Math.min(amt, med * 2);
    }
    monthlySupplierRunRate.set(
      cid,
      (monthlySupplierRunRate.get(cid) ?? 0) + amt
    );
    if (r.invoice_date) {
      const month = r.invoice_date.slice(0, 7);
      const set = supplierActiveMonths.get(cid) ?? new Set<string>();
      set.add(month);
      supplierActiveMonths.set(cid, set);
    }
  }
  // Probabilidad por tier de recurrencia × calibración empírica (proveedores).
  // Tiers basados en 12m activos:
  //   ≥9 meses: 0.95 × calibration
  //   6-8:      0.80 × calibration
  //   3-5:      0.60 × calibration
  //   2:        0.35 × calibration
  //   1:        skip
  // Suppliers ligeramente mayor que clientes (compras más predecibles —
  // hay contratos/necesidades operativas constantes).
  const probabilityForSupplierRecurrence = (
    months12: number,
    freshRate: number
  ): number => {
    let base = 0;
    if (months12 >= 9) base = 0.95;
    else if (months12 >= 6) base = 0.8;
    else if (months12 >= 3) base = 0.6;
    else if (months12 === 2) base = 0.35;
    else return 0;
    return base * Math.max(0.5, Math.min(1.0, freshRate));
  };
  for (const [canonicalId, lookbackTotal] of monthlySupplierRunRate) {
    const monthlyAvg = lookbackTotal / 3;
    if (monthlyAvg <= 0) continue;
    const bronzeId = supplierCanonicalToBronze.get(canonicalId);
    if (bronzeId == null) continue;
    // Capa 3 supplier filter: mismo principio que customers — solo
    // operativo + active. Excluye intercom, financiera (no compramos
    // producto a banco), gobierno (impuestos viven en recurrentes),
    // utility (en recurrentes), one_off, lost, dormant.
    if (isExcludedFromRunRate(bronzeId)) continue;

    const supplierActive3m = supplierActiveMonths.get(canonicalId)?.size ?? 0;
    // Combinar canonical 12m + SAT 24m igual que con clientes
    const learnedSp = learnedCounterparty.byBronzeId.get(bronzeId);
    const learnedSatSp = learnedHistorical.byBronzeId.get(bronzeId);
    const canonicalActive12mSp = learnedSp?.activeMonthsLast12 ?? supplierActive3m;
    const satActive24mSp = learnedSatSp?.activeMonthsLast24 ?? 0;
    const effectiveActive12mSp = Math.max(
      canonicalActive12mSp,
      Math.round(satActive24mSp / 2)
    );
    const supplierProb = probabilityForSupplierRecurrence(
      effectiveActive12mSp,
      freshPaymentRate
    );
    if (supplierProb <= 0) continue; // one-off, no proyectar

    const supplierTrend = learnedSp?.trendFactor ?? 1.0;
    // Seasonality del proveedor sobre meses del horizonte
    let supplierSeasonality = 1.0;
    if (learnedSatSp?.seasonalityByMonth?.length === 13) {
      const cursor = new Date(today);
      const factors: number[] = [];
      while (cursor <= endDate) {
        const moy = cursor.getMonth() + 1;
        factors.push(learnedSatSp.seasonalityByMonth[moy] ?? 1.0);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      if (factors.length > 0) {
        const avg = factors.reduce((s, f) => s + f, 0) / factors.length;
        supplierSeasonality = Math.max(0.5, Math.min(2.0, avg));
      }
    }
    const expectedInHorizon =
      monthlyAvg * supplierTrend * supplierSeasonality * horizonProportion;
    const apCommitted = apCommittedBySupplier.get(bronzeId) ?? 0;
    const residualNominal = Math.max(0, expectedInHorizon - apCommitted);
    if (residualNominal <= 0) continue;

    // Preferir learned median delay (12m) sobre RPC silver (6m)
    const apDelay =
      learnedSp?.medianDelayDays != null && learnedSp.paymentSampleSize >= 5
        ? learnedSp.medianDelayDays
        : apDelayMap.get(bronzeId)?.delayDays ?? 30;
    const dayOffset = stableHash(`runrate-supplier-${bronzeId}`) % 7;
    const firstPayDate = shiftDate(todayIso, apDelay + dayOffset);

    const paymentDates: string[] = [];
    const cursor = new Date(firstPayDate);
    while (cursor <= endDate) {
      paymentDates.push(toIso(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    if (paymentDates.length === 0) continue;

    const weightedTotal = residualNominal * supplierProb;
    const perPayment = weightedTotal / paymentDates.length;
    const nominalPerPayment = residualNominal / paymentDates.length;

    totalOutflow += weightedTotal;
    addToCategory(
      "runrate_proveedores",
      "Run rate (compras nuevas a proveedores)",
      "outflow",
      weightedTotal
    );
    for (const payDate of paymentDates) {
      outflowByDay.set(
        payDate,
        (outflowByDay.get(payDate) ?? 0) + perPayment
      );
      pushEvent({
        date: payDate,
        kind: "outflow",
        amountMxn: perPayment,
        nominalAmountMxn: nominalPerPayment,
        label: "Run rate compras (proveedor activo)",
        category: "runrate_proveedores",
        categoryLabel: "Run rate (compras nuevas a proveedores)",
        probability: supplierProb,
        companyId: bronzeId,
        counterpartyName: null,
        daysOverdue: null,
      });
    }
  }

  // ── Nómina client-side basada en CFDIs SAT ────────────────────────────
  // Source of truth: syntage_invoices tipo='N' direction='issued'
  // (CFDIs de nómina que la empresa emite a cada empleado).
  //
  // Quimibond paga DOS cohortes:
  //   - SEMANAL: 99 empleados, CFDI cada viernes (~$1.91M/mes en viernes)
  //   - QUINCENAL: 65 empleados, CFDI días 15 + último (~$1.10M/mes)
  //
  // Usamos TOTAL_MXN del CFDI = NETO al empleado (lo que sale del banco).
  // El bruto (subtotal) NO se usa porque incluye retenciones que ya están
  // proyectadas en `impuestos_sat` día 17 — usar bruto duplicaría el cash.
  //
  // Algoritmo:
  //   1. Agregar CFDIs por día (lookback 6 meses, excluir mes actual y diciembre).
  //   2. Clasificar cada día: quincenal (días 15, 28-31) vs semanal (otros, mayoría viernes).
  //   3. Calcular promedio por evento:
  //      - quincena_avg = total_quincenal / # eventos_quincenal
  //      - viernes_avg = total_semanal / # viernes_observados
  //   4. Proyectar al horizonte:
  //      - Cada viernes ∈ horizonte: +viernes_avg
  //      - Día 15 + último de cada mes ∈ horizonte: +quincena_avg
  //   5. Aguinaldo (solo si horizonte cruza diciembre): delta dec_subtotal
  //      vs subtotal_avg ≈ provisión anual. Proyectar 20-dic.
  type CfdiNominaRow = {
    fecha_emision: string | null;
    total_mxn: number | null;
    subtotal: number | null;
  };
  const cfdiNominaRows = (nominaCfdiRes.data ?? []) as CfdiNominaRow[];

  // Agregar por día con clasificación quincenal/semanal
  type DayBucket = {
    iso: string;
    dayOfMonth: number;
    dayOfWeek: number;
    total: number;
    subtotal: number;
  };
  const dayBuckets = new Map<string, DayBucket>();
  for (const r of cfdiNominaRows) {
    if (!r.fecha_emision) continue;
    const iso = r.fecha_emision.slice(0, 10);
    const d = new Date(iso);
    const dom = d.getDate();
    const dow = d.getDay();
    const total = Number(r.total_mxn) || 0;
    const subtotal = Number(r.subtotal) || 0;
    if (total <= 0) continue;
    const acc = dayBuckets.get(iso) ?? {
      iso,
      dayOfMonth: dom,
      dayOfWeek: dow,
      total: 0,
      subtotal: 0,
    };
    acc.total += total;
    acc.subtotal += subtotal;
    dayBuckets.set(iso, acc);
  }

  // Clasificación: día 14, 15, 16 → quincenal mid; 28-31 → quincenal fin.
  // Otros días con volumen significativo → semanal (típicamente viernes).
  const FORTNIGHT_MID_DAYS = new Set([14, 15, 16]);
  const FORTNIGHT_END_DAYS = new Set([28, 29, 30, 31]);
  const isFortnightDay = (dom: number): boolean =>
    FORTNIGHT_MID_DAYS.has(dom) || FORTNIGHT_END_DAYS.has(dom);

  // Excluir mes actual (parcial) y diciembre (atípico por aguinaldo).
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  let totalFortnight = 0;
  let countFortnightEvents = 0;
  let totalWeekly = 0;
  let totalWeeklySubtotal = 0;
  let totalFortnightSubtotal = 0;
  const weeklyEventsObserved = new Set<string>(); // ISO de viernes únicos
  const decemberDayBuckets: DayBucket[] = [];
  // Audit 2026-04-27 finding #13: PTU (mayo), bonos extraordinarios, primas
  // de antigüedad, etc. inflan el avg si caen en el lookback. Aplicamos
  // winsorización per-tipo: cap cada evento a 2× la mediana de su grupo.
  // Aguinaldo ya está aislado (excluye diciembre del baseline).
  const fortnightEventTotals: number[] = [];
  const weeklyEventTotals: number[] = [];
  for (const b of dayBuckets.values()) {
    const ym = b.iso.slice(0, 7);
    if (ym === currentMonthKey) continue; // mes parcial
    if (b.iso.slice(5, 7) === "12") {
      decemberDayBuckets.push(b);
      continue; // diciembre se trata aparte
    }
    if (isFortnightDay(b.dayOfMonth)) {
      fortnightEventTotals.push(b.total);
    } else if (b.dayOfWeek === 5) {
      weeklyEventTotals.push(b.total);
    }
  }
  const medianForArr = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };
  // Cap solo cuando hay ≥4 eventos del tipo (estadística). Con menos
  // mantenemos el dato crudo (puede ser empresa nueva o data limitada).
  const fortnightMed = fortnightEventTotals.length >= 4 ? medianForArr(fortnightEventTotals) : 0;
  const weeklyMed = weeklyEventTotals.length >= 4 ? medianForArr(weeklyEventTotals) : 0;
  // Tracker de eventos extraordinarios identificados (suma del exceso) →
  // futuro: proyectar como pagos puntuales en su mes correspondiente.
  let fortnightExtraordinaryDetected = 0;
  let weeklyExtraordinaryDetected = 0;

  for (const b of dayBuckets.values()) {
    const ym = b.iso.slice(0, 7);
    if (ym === currentMonthKey) continue; // mes parcial
    if (b.iso.slice(5, 7) === "12") continue; // ya en decemberDayBuckets
    if (isFortnightDay(b.dayOfMonth)) {
      let total = b.total;
      let subtotal = b.subtotal;
      if (fortnightMed > 0 && total > fortnightMed * 2) {
        const excess = total - fortnightMed * 2;
        fortnightExtraordinaryDetected += excess;
        const ratio = total > 0 ? (fortnightMed * 2) / total : 0;
        subtotal = subtotal * ratio;
        total = fortnightMed * 2;
      }
      totalFortnight += total;
      totalFortnightSubtotal += subtotal;
      countFortnightEvents++;
    } else {
      let total = b.total;
      let subtotal = b.subtotal;
      // Solo cap eventos de viernes (los otros días son ruido — días que
      // ocasionalmente reciben CFDIs sueltos por correcciones).
      if (b.dayOfWeek === 5 && weeklyMed > 0 && total > weeklyMed * 2) {
        const excess = total - weeklyMed * 2;
        weeklyExtraordinaryDetected += excess;
        const ratio = total > 0 ? (weeklyMed * 2) / total : 0;
        subtotal = subtotal * ratio;
        total = weeklyMed * 2;
      }
      totalWeekly += total;
      totalWeeklySubtotal += subtotal;
      // Contar viernes únicos como "evento semanal"
      if (b.dayOfWeek === 5) {
        weeklyEventsObserved.add(b.iso);
      }
    }
  }
  // NOTA: fortnightExtraordinaryDetected + weeklyExtraordinaryDetected
  // representan el "exceso" de PTU/bonos detectado en el lookback. No los
  // proyectamos al horizonte porque no sabemos si caerán dentro (PTU es
  // típicamente mayo, bonos varían). Quedan como señal en el log para
  // futuras iteraciones — proyectar PTU al 30-may por categoría aparte.

  // Promedio por evento. Si no hay viernes (datos cortos), usar fallback.
  const fortnightAvgNet =
    countFortnightEvents > 0 ? totalFortnight / countFortnightEvents : 0;
  const weeklyAvgNet =
    weeklyEventsObserved.size > 0
      ? totalWeekly / weeklyEventsObserved.size
      : 0;

  // Aguinaldo: estimar como (subtotal_dec - subtotal_baseline). Si
  // diciembre histórico no está disponible, usar provisión 1/12 anual.
  let aguinaldoEstimate = 0;
  if (decemberDayBuckets.length > 0) {
    const decTotalSubtotal = decemberDayBuckets.reduce(
      (s, b) => s + b.subtotal,
      0
    );
    // Baseline mensual: avg(viernes_subtotal × ~4.3 + quincenal_subtotal × 2)
    const monthlyBaseline =
      (weeklyEventsObserved.size > 0
        ? (totalWeeklySubtotal / weeklyEventsObserved.size) * 4.33
        : 0) +
      (countFortnightEvents > 0
        ? (totalFortnightSubtotal / countFortnightEvents) * 2
        : 0);
    aguinaldoEstimate = Math.max(0, decTotalSubtotal - monthlyBaseline);
  } else {
    // Provisión 15 días salario: subtotal_avg × 12 × 15/365
    const monthlySubtotalAvg =
      (weeklyEventsObserved.size > 0
        ? (totalWeeklySubtotal / weeklyEventsObserved.size) * 4.33
        : 0) +
      (countFortnightEvents > 0
        ? (totalFortnightSubtotal / countFortnightEvents) * 2
        : 0);
    aguinaldoEstimate = monthlySubtotalAvg * 12 * (15 / 365);
  }

  const pushNominaOutflow = (
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

  // Generar pagos a lo largo del horizonte
  // 1. Semanales: cada viernes en [today, endDate]
  if (weeklyAvgNet > 0) {
    const cursor = new Date(today);
    while (cursor <= endDate) {
      if (cursor.getDay() === 5) {
        // viernes
        const iso = toIso(cursor);
        if (iso >= todayIso) {
          pushNominaOutflow(
            iso,
            weeklyAvgNet,
            "Nómina semanal (99 empleados)",
            iso
          );
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // 2. Quincenales: día 15 + último día de cada mes en horizonte
  if (fortnightAvgNet > 0) {
    const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cursor <= endDate) {
      const y = cursor.getFullYear();
      const mo = cursor.getMonth();
      const day15 = new Date(y, mo, 15);
      const lastDay = new Date(y, mo + 1, 0);
      const yyyymm = `${y}-${String(mo + 1).padStart(2, "0")}`;
      const day15Iso = toIso(day15);
      const lastIso = toIso(lastDay);
      if (day15Iso >= todayIso && day15Iso <= endIso) {
        pushNominaOutflow(
          day15Iso,
          fortnightAvgNet,
          "Nómina quincena 15 (65 empleados)",
          yyyymm
        );
      }
      if (lastIso >= todayIso && lastIso <= endIso && lastIso !== day15Iso) {
        pushNominaOutflow(
          lastIso,
          fortnightAvgNet,
          "Nómina quincena fin (65 empleados)",
          yyyymm
        );
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // 3. Aguinaldo: 20 dic si está en horizonte
  if (aguinaldoEstimate > 0) {
    const cursor = new Date(today);
    while (cursor <= endDate) {
      if (cursor.getMonth() === 11) {
        const dec20 = toIso(new Date(cursor.getFullYear(), 11, 20));
        if (dec20 >= todayIso && dec20 <= endIso) {
          pushNominaOutflow(
            dec20,
            aguinaldoEstimate,
            "Aguinaldo (anual)",
            `dic-${cursor.getFullYear()}`
          );
        }
        break;
      }
      cursor.setMonth(cursor.getMonth() + 1);
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
    openingBalanceStale,
    openingBalanceStaleHours: Math.round(openingBalanceStaleHours),
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
    learning: {
      canonicalSampleSize: agingCalibration.totalSample,
      canonicalCounterparties: learnedCounterparty.totalCounterparties,
      satCounterparties: learnedHistorical.totalCounterparties,
      satOldestRecord: learnedHistorical.oldestRecord,
      freshPaymentRate,
      freshHeuristicRate: 0.95,
      asOfDate: agingCalibration.asOfDate,
    },
  };
}

export const getCashProjection = unstable_cache(
  _getCashProjectionRaw,
  ["sp13-finanzas-cash-projection-v28-nomina-winsorize"],
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
