import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Finance queries v2 — usa las VIEWS canónicas del backend.
 * Todas las vistas ya están normalizadas a MXN, no necesitan `toMxn()`.
 *
 * Fuentes:
 * - `cfo_dashboard` — snapshot ejecutivo (1 row)
 * - `financial_runway` — runway en días + net position 30d
 * - `working_capital` — ratios de liquidez + capital de trabajo
 * - `pl_estado_resultados` — P&L mensual por periodo
 * - `cash_position` — detalle de saldos bancarios
 * - `working_capital_cycle` — DSO/DPO/DIO/CCC con COGS real (Sprint 8)
 */

/** Snapshot ejecutivo del CFO (view: cfo_dashboard).
 *  El view expone efectivo_mxn (solo MXN) y efectivo_total_mxn (MXN + USD*rate).
 *  El frontend usa el total como "efectivo disponible" porque es el numero real
 *  que el CEO quiere ver en una sola moneda. */
export interface CfoSnapshot {
  efectivoMxn: number;
  efectivoUsd: number;
  efectivoTotalMxn: number;
  deudaTarjetas: number;
  posicionNeta: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  carteraVencida: number;
  ventas30d: number;
  cobros30d: number;
  pagosProv30d: number;
  clientesMorosos: number;
}

export async function getCfoSnapshot(): Promise<CfoSnapshot | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("cfo_dashboard").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    efectivo_mxn: number | null;
    efectivo_usd: number | null;
    efectivo_total_mxn: number | null;
    deuda_tarjetas: number | null;
    posicion_neta: number | null;
    cuentas_por_cobrar: number | null;
    cuentas_por_pagar: number | null;
    cartera_vencida: number | null;
    ventas_30d: number | null;
    cobros_30d: number | null;
    pagos_prov_30d: number | null;
    clientes_morosos: number | null;
  };
  return {
    efectivoMxn: Number(d.efectivo_mxn) || 0,
    efectivoUsd: Number(d.efectivo_usd) || 0,
    efectivoTotalMxn: Number(d.efectivo_total_mxn) || 0,
    deudaTarjetas: Number(d.deuda_tarjetas) || 0,
    posicionNeta: Number(d.posicion_neta) || 0,
    cuentasPorCobrar: Number(d.cuentas_por_cobrar) || 0,
    cuentasPorPagar: Number(d.cuentas_por_pagar) || 0,
    carteraVencida: Number(d.cartera_vencida) || 0,
    ventas30d: Number(d.ventas_30d) || 0,
    cobros30d: Number(d.cobros_30d) || 0,
    pagosProv30d: Number(d.pagos_prov_30d) || 0,
    clientesMorosos: Number(d.clientes_morosos) || 0,
  };
}

/** Runway + net position 30d (view: financial_runway) */
export interface FinancialRunway {
  cashMxn: number;
  expectedInMxn: number;
  dueOutMxn: number;
  netPosition30d: number;
  burnRateDaily: number;
  runwayDaysNet: number;
  runwayDaysCashOnly: number;
  computedAt: string | null;
}

export async function getFinancialRunway(): Promise<FinancialRunway | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("financial_runway").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    cash_mxn: number | null;
    expected_in_mxn: number | null;
    due_out_mxn: number | null;
    net_position_30d: number | null;
    burn_rate_daily: number | null;
    runway_days_net: number | null;
    runway_days_cash_only: number | null;
    computed_at: string | null;
  };
  return {
    cashMxn: Number(d.cash_mxn) || 0,
    expectedInMxn: Number(d.expected_in_mxn) || 0,
    dueOutMxn: Number(d.due_out_mxn) || 0,
    netPosition30d: Number(d.net_position_30d) || 0,
    burnRateDaily: Number(d.burn_rate_daily) || 0,
    runwayDaysNet: Number(d.runway_days_net) || 0,
    runwayDaysCashOnly: Number(d.runway_days_cash_only) || 0,
    computedAt: d.computed_at,
  };
}

/** Capital de trabajo (view: working_capital) */
export interface WorkingCapital {
  efectivoDisponible: number;
  deudaTarjetas: number;
  efectivoNeto: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  capitalDeTrabajo: number;
  ratioLiquidez: number;
  ratioPruebaAcida: number;
}

export async function getWorkingCapital(): Promise<WorkingCapital | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("working_capital").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    efectivo_disponible: number | null;
    deuda_tarjetas: number | null;
    efectivo_neto: number | null;
    cuentas_por_cobrar: number | null;
    cuentas_por_pagar: number | null;
    capital_de_trabajo: number | null;
    ratio_liquidez: number | null;
    ratio_prueba_acida: number | null;
  };
  return {
    efectivoDisponible: Number(d.efectivo_disponible) || 0,
    deudaTarjetas: Number(d.deuda_tarjetas) || 0,
    efectivoNeto: Number(d.efectivo_neto) || 0,
    cuentasPorCobrar: Number(d.cuentas_por_cobrar) || 0,
    cuentasPorPagar: Number(d.cuentas_por_pagar) || 0,
    capitalDeTrabajo: Number(d.capital_de_trabajo) || 0,
    ratioLiquidez: Number(d.ratio_liquidez) || 0,
    ratioPruebaAcida: Number(d.ratio_prueba_acida) || 0,
  };
}

/** Saldo bancario (view: cash_position).
 *  - saldo: en la moneda nativa del journal (post qb19 fix: USD/EUR/MXN reales)
 *  - saldoMxn: siempre MXN (valor del ledger company currency)
 *  Frontend muestra saldoMxn por default; saldo nativo como info adicional. */
export interface BankBalance {
  banco: string | null;
  tipo: string | null;
  moneda: string | null;
  cuenta: string | null;
  saldo: number;
  saldoMxn: number;
}

export async function getCashPosition(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cash_position")
    .select("banco, tipo, moneda, cuenta, saldo, saldo_mxn")
    .order("saldo_mxn", { ascending: false });
  return ((data ?? []) as Array<{
    banco: string | null;
    tipo: string | null;
    moneda: string | null;
    cuenta: string | null;
    saldo: number | null;
    saldo_mxn: number | null;
  }>).map((r) => ({
    banco: r.banco,
    tipo: r.tipo,
    moneda: r.moneda,
    cuenta: r.cuenta,
    saldo: Number(r.saldo) || 0,
    saldoMxn: Number(r.saldo_mxn) || 0,
  }));
}

/** Punto P&L por mes (view: pl_estado_resultados) */
export interface PlPoint {
  period: string;
  ingresos: number;
  costoVentas: number;
  gastosOperativos: number;
  utilidadBruta: number;
  utilidadOperativa: number;
  otrosNeto: number;
}

export async function getPlHistory(months = 12): Promise<PlPoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pl_estado_resultados")
    .select("*")
    .order("period", { ascending: false })
    .limit(months + 5); // buffer para filtrar datos corruptos
  const rows = (data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
    costo_ventas: number | null;
    gastos_operativos: number | null;
    utilidad_bruta: number | null;
    utilidad_operativa: number | null;
    otros_neto: number | null;
  }>;
  // filtra rows con periods inválidos (ej '2202-02') y los sin ingresos
  const valid = rows.filter((r) => {
    if (!r.period) return false;
    const [y] = r.period.split("-");
    const year = Number(y);
    return year >= 2020 && year <= 2030;
  });
  return valid
    .slice(0, months)
    .map((r) => ({
      period: r.period as string,
      ingresos: Number(r.ingresos) || 0,
      costoVentas: Number(r.costo_ventas) || 0,
      gastosOperativos: Number(r.gastos_operativos) || 0,
      utilidadBruta: Number(r.utilidad_bruta) || 0,
      utilidadOperativa: Number(r.utilidad_operativa) || 0,
      otrosNeto: Number(r.otros_neto) || 0,
    }))
    .reverse(); // orden cronológico ascendente
}

/**
 * Working Capital Cycle (view: working_capital_cycle).
 * DSO/DPO/DIO/CCC computados con COGS desde expense_direct_cost
 * (no proxy de in_invoices). Sprint 8 / audit 2026-04-14.
 */
export interface WorkingCapitalCycle {
  revenue12mMxn: number;
  cogs12mMxn: number;
  grossProfit12mMxn: number;
  grossMarginPct: number;
  arMxn: number;
  apMxn: number;
  inventoryMxn: number;
  dsoDays: number | null;
  dpoDays: number | null;
  dioDays: number | null;
  cccDays: number | null;
  workingCapitalMxn: number;
  computedAt: string | null;
}

export async function getWorkingCapitalCycle(): Promise<WorkingCapitalCycle | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("working_capital_cycle")
    .select("*")
    .maybeSingle();
  if (!data) return null;
  const d = data as {
    revenue_12m_mxn: number | null;
    cogs_12m_mxn: number | null;
    gross_profit_12m_mxn: number | null;
    gross_margin_pct: number | null;
    ar_mxn: number | null;
    ap_mxn: number | null;
    inventory_mxn: number | null;
    dso_days: number | null;
    dpo_days: number | null;
    dio_days: number | null;
    ccc_days: number | null;
    working_capital_mxn: number | null;
    computed_at: string | null;
  };
  return {
    revenue12mMxn: Number(d.revenue_12m_mxn) || 0,
    cogs12mMxn: Number(d.cogs_12m_mxn) || 0,
    grossProfit12mMxn: Number(d.gross_profit_12m_mxn) || 0,
    grossMarginPct: Number(d.gross_margin_pct) || 0,
    arMxn: Number(d.ar_mxn) || 0,
    apMxn: Number(d.ap_mxn) || 0,
    inventoryMxn: Number(d.inventory_mxn) || 0,
    dsoDays: d.dso_days != null ? Number(d.dso_days) : null,
    dpoDays: d.dpo_days != null ? Number(d.dpo_days) : null,
    dioDays: d.dio_days != null ? Number(d.dio_days) : null,
    cccDays: d.ccc_days != null ? Number(d.ccc_days) : null,
    workingCapitalMxn: Number(d.working_capital_mxn) || 0,
    computedAt: d.computed_at,
  };
}
/**
 * Projected Cash Flow v2 — método directo 13 semanas.
 *
 * Backend: VIEW projected_cash_flow_weekly + RPC get_projected_cash_flow_summary.
 * Cada flujo (AR/SO/AP/PO) se expone en gross y weighted (confidence-adjusted).
 * Cash operativo clasifica bancos en operative/restricted/cc_debt y el opening
 * balance ya incluye cash en tránsito (cuentas transitorias del CoA) y ajusta
 * por pagos no conciliados para evitar doble conteo.
 */
export interface ProjectedCashFlowWeek {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  // Inflows
  arGross: number;
  arWeighted: number;
  arOverdueGross: number;
  soGross: number;
  soWeighted: number;
  inflowsWeighted: number;
  inflowsGross: number;
  // Outflows
  apGross: number;
  apWeighted: number;
  apOverdueGross: number;
  poGross: number;
  poWeighted: number;
  payrollEstimated: number;
  opexRecurring: number;
  taxEstimated: number;
  outflowsWeighted: number;
  outflowsGross: number;
  // Balance
  netFlow: number;
  openingBalance: number;
  closingBalance: number;
}

export interface ProjectedCashFlowCash {
  netMxn: number;
  operativeMxn: number;
  restrictedMxn: number;
  ccDebtMxn: number;
  inTransitMxn: number;
  effectiveMxn: number;
  usdRate: number | null;
  eurRate: number | null;
  activeAccounts: number;
  inTransitAccounts: number;
}

export interface ProjectedCashFlowUnreconciled {
  unmatchedInboundMxn: number;
  unmatchedOutboundMxn: number;
  pendingInboundMxn: number;
  pendingOutboundMxn: number;
  nUnmatchedInbound: number;
  nUnmatchedOutbound: number;
  nPendingInbound: number;
  nPendingOutbound: number;
}

export interface ProjectedCashFlowOpenPositions {
  arTotalMxn: number;
  arOverdueMxn: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  soBacklogMxn: number;
  poBacklogMxn: number;
}

export interface RecurringSource {
  monthlyMxn: number;
  weeklyMxn?: number;
  monthsUsed: number;
  periods?: string;
}

export interface ProjectedCashFlowRecurringSources {
  payroll: RecurringSource;
  opex: RecurringSource;
  tax: RecurringSource;
}

export interface ProjectedCashFlowSummary {
  cash: ProjectedCashFlowCash;
  unreconciled: ProjectedCashFlowUnreconciled;
  totals13w: {
    inflowsWeighted: number;
    inflowsGross: number;
    outflowsWeighted: number;
    outflowsGross: number;
    netFlow: number;
    minClosingBalance: number | null;
    maxClosingBalance: number | null;
  };
  firstNegativeWeek: {
    weekIndex: number;
    weekStart: string;
    closingBalance: number;
  } | null;
  openPositions: ProjectedCashFlowOpenPositions;
  recurringSources: ProjectedCashFlowRecurringSources;
  computedAt: string | null;
}

export interface ProjectedCashFlow {
  summary: ProjectedCashFlowSummary | null;
  weeks: ProjectedCashFlowWeek[];
}

type RawWeek = {
  week_index: number | null;
  week_start: string | null;
  week_end: string | null;
  ar_gross: number | null;
  ar_weighted: number | null;
  ar_overdue_gross: number | null;
  so_gross: number | null;
  so_weighted: number | null;
  ap_gross: number | null;
  ap_weighted: number | null;
  ap_overdue_gross: number | null;
  po_gross: number | null;
  po_weighted: number | null;
  payroll_estimated: number | null;
  opex_recurring: number | null;
  tax_estimated: number | null;
  inflows_weighted: number | null;
  inflows_gross: number | null;
  outflows_weighted: number | null;
  outflows_gross: number | null;
  net_flow: number | null;
  opening_balance: number | null;
  closing_balance: number | null;
};

function mapWeek(r: RawWeek): ProjectedCashFlowWeek {
  return {
    weekIndex: Number(r.week_index) || 0,
    weekStart: r.week_start ?? "",
    weekEnd: r.week_end ?? "",
    arGross: Number(r.ar_gross) || 0,
    arWeighted: Number(r.ar_weighted) || 0,
    arOverdueGross: Number(r.ar_overdue_gross) || 0,
    soGross: Number(r.so_gross) || 0,
    soWeighted: Number(r.so_weighted) || 0,
    apGross: Number(r.ap_gross) || 0,
    apWeighted: Number(r.ap_weighted) || 0,
    apOverdueGross: Number(r.ap_overdue_gross) || 0,
    poGross: Number(r.po_gross) || 0,
    poWeighted: Number(r.po_weighted) || 0,
    payrollEstimated: Number(r.payroll_estimated) || 0,
    opexRecurring: Number(r.opex_recurring) || 0,
    taxEstimated: Number(r.tax_estimated) || 0,
    inflowsWeighted: Number(r.inflows_weighted) || 0,
    inflowsGross: Number(r.inflows_gross) || 0,
    outflowsWeighted: Number(r.outflows_weighted) || 0,
    outflowsGross: Number(r.outflows_gross) || 0,
    netFlow: Number(r.net_flow) || 0,
    openingBalance: Number(r.opening_balance) || 0,
    closingBalance: Number(r.closing_balance) || 0,
  };
}

type RawSummary = {
  computed_at: string | null;
  cash: {
    net_mxn: number | null;
    operative_mxn: number | null;
    restricted_mxn: number | null;
    cc_debt_mxn: number | null;
    in_transit_mxn: number | null;
    effective_mxn: number | null;
    usd_rate: number | null;
    eur_rate: number | null;
    active_accounts: number | null;
    in_transit_accounts: number | null;
  };
  unreconciled: {
    unmatched_inbound_mxn: number | null;
    unmatched_outbound_mxn: number | null;
    pending_inbound_mxn: number | null;
    pending_outbound_mxn: number | null;
    n_unmatched_inbound: number | null;
    n_unmatched_outbound: number | null;
    n_pending_inbound: number | null;
    n_pending_outbound: number | null;
  };
  totals_13w: {
    inflows_weighted: number | null;
    inflows_gross: number | null;
    outflows_weighted: number | null;
    outflows_gross: number | null;
    net_flow: number | null;
    min_closing_balance: number | null;
    max_closing_balance: number | null;
  };
  first_negative_week: {
    week_index: number;
    week_start: string;
    closing_balance: number;
  } | null;
  open_positions: {
    ar_total_mxn: number | null;
    ar_overdue_mxn: number | null;
    ap_total_mxn: number | null;
    ap_overdue_mxn: number | null;
    so_backlog_mxn: number | null;
    po_backlog_mxn: number | null;
  };
  recurring_sources: {
    payroll: { monthly_mxn: number | null; months_used: number | null; periods?: string; weekly_mxn?: number };
    opex: { monthly_mxn: number | null; months_used: number | null; periods?: string; weekly_mxn?: number };
    tax: { monthly_mxn: number | null; months_used: number | null };
  };
};

function mapSource(s: {
  monthly_mxn: number | null;
  months_used: number | null;
  periods?: string;
  weekly_mxn?: number;
}): RecurringSource {
  return {
    monthlyMxn: Number(s.monthly_mxn) || 0,
    weeklyMxn: s.weekly_mxn != null ? Number(s.weekly_mxn) : undefined,
    monthsUsed: Number(s.months_used) || 0,
    periods: s.periods,
  };
}

export async function getProjectedCashFlow(): Promise<ProjectedCashFlow> {
  const sb = getServiceClient();
  const [{ data: weeksRaw }, { data: summaryRaw }] = await Promise.all([
    sb
      .from("projected_cash_flow_weekly")
      .select("*")
      .order("week_index", { ascending: true }),
    sb.rpc("get_projected_cash_flow_summary"),
  ]);

  const weeks = ((weeksRaw ?? []) as RawWeek[]).map(mapWeek);

  const s = (summaryRaw ?? null) as RawSummary | null;
  const summary: ProjectedCashFlowSummary | null = s
    ? {
        computedAt: s.computed_at,
        cash: {
          netMxn: Number(s.cash?.net_mxn) || 0,
          operativeMxn: Number(s.cash?.operative_mxn) || 0,
          restrictedMxn: Number(s.cash?.restricted_mxn) || 0,
          ccDebtMxn: Number(s.cash?.cc_debt_mxn) || 0,
          inTransitMxn: Number(s.cash?.in_transit_mxn) || 0,
          effectiveMxn: Number(s.cash?.effective_mxn) || 0,
          usdRate: s.cash?.usd_rate != null ? Number(s.cash.usd_rate) : null,
          eurRate: s.cash?.eur_rate != null ? Number(s.cash.eur_rate) : null,
          activeAccounts: Number(s.cash?.active_accounts) || 0,
          inTransitAccounts: Number(s.cash?.in_transit_accounts) || 0,
        },
        unreconciled: {
          unmatchedInboundMxn: Number(s.unreconciled?.unmatched_inbound_mxn) || 0,
          unmatchedOutboundMxn: Number(s.unreconciled?.unmatched_outbound_mxn) || 0,
          pendingInboundMxn: Number(s.unreconciled?.pending_inbound_mxn) || 0,
          pendingOutboundMxn: Number(s.unreconciled?.pending_outbound_mxn) || 0,
          nUnmatchedInbound: Number(s.unreconciled?.n_unmatched_inbound) || 0,
          nUnmatchedOutbound: Number(s.unreconciled?.n_unmatched_outbound) || 0,
          nPendingInbound: Number(s.unreconciled?.n_pending_inbound) || 0,
          nPendingOutbound: Number(s.unreconciled?.n_pending_outbound) || 0,
        },
        totals13w: {
          inflowsWeighted: Number(s.totals_13w?.inflows_weighted) || 0,
          inflowsGross: Number(s.totals_13w?.inflows_gross) || 0,
          outflowsWeighted: Number(s.totals_13w?.outflows_weighted) || 0,
          outflowsGross: Number(s.totals_13w?.outflows_gross) || 0,
          netFlow: Number(s.totals_13w?.net_flow) || 0,
          minClosingBalance:
            s.totals_13w?.min_closing_balance != null
              ? Number(s.totals_13w.min_closing_balance)
              : null,
          maxClosingBalance:
            s.totals_13w?.max_closing_balance != null
              ? Number(s.totals_13w.max_closing_balance)
              : null,
        },
        firstNegativeWeek: s.first_negative_week
          ? {
              weekIndex: Number(s.first_negative_week.week_index) || 0,
              weekStart: String(s.first_negative_week.week_start ?? ""),
              closingBalance: Number(s.first_negative_week.closing_balance) || 0,
            }
          : null,
        openPositions: {
          arTotalMxn: Number(s.open_positions?.ar_total_mxn) || 0,
          arOverdueMxn: Number(s.open_positions?.ar_overdue_mxn) || 0,
          apTotalMxn: Number(s.open_positions?.ap_total_mxn) || 0,
          apOverdueMxn: Number(s.open_positions?.ap_overdue_mxn) || 0,
          soBacklogMxn: Number(s.open_positions?.so_backlog_mxn) || 0,
          poBacklogMxn: Number(s.open_positions?.po_backlog_mxn) || 0,
        },
        recurringSources: {
          payroll: mapSource(s.recurring_sources?.payroll ?? { monthly_mxn: 0, months_used: 0 }),
          opex: mapSource(s.recurring_sources?.opex ?? { monthly_mxn: 0, months_used: 0 }),
          tax: mapSource(s.recurring_sources?.tax ?? { monthly_mxn: 0, months_used: 0 }),
        },
      }
    : null;

  return { summary, weeks };
}


/* ============================================================================
 * Cashflow Recommendations Engine
 *   RPC: get_cashflow_recommendations()
 *   Returns prioritized actions based on the liquidity situation.
 * ========================================================================== */

export type RecommendationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING';

export interface CashflowRecommendationAction {
  priority: number;
  severity: RecommendationSeverity;
  category: string;
  title: string;
  rationale: string;
  action: string;
  impactMxn: number;
}

export interface CashflowTopCompany {
  companyId: number | null;
  companyName: string | null;
  totalOverdueMxn: number;
  nInvoices: number;
  maxDaysOverdue: number;
  avgDaysOverdue: number;
  collectionProbability14d?: number;
  expectedCollection14dMxn?: number;
}

export interface CashflowRecommendations {
  computedAt: string | null;
  metrics: {
    effectiveCashMxn: number;
    apOverdueMxn: number;
    arOverdueMxn: number;
    liquidityGapMxn: number;
    apOverdueCoverageRatio: number | null;
    runwayWeeksRecurring: number | null;
    burnRateWeeklyMxn: number;
    payrollQuincenalMxn: number;
    opexWeeklyMxn: number;
    taxWeeklyMxn: number;
  };
  topArToCollect: CashflowTopCompany[];
  topApToNegotiate: CashflowTopCompany[];
  actions: CashflowRecommendationAction[];
}

export async function getCashflowRecommendations(): Promise<CashflowRecommendations | null> {
  const sb = getServiceClient();
  const { data } = await sb.rpc('get_cashflow_recommendations');
  if (!data) return null;
  const r = data as {
    computed_at: string | null;
    metrics: Record<string, number | null>;
    top_ar_to_collect: Array<Record<string, unknown>>;
    top_ap_to_negotiate: Array<Record<string, unknown>>;
    actions: Array<Record<string, unknown>>;
  };
  const num = (x: unknown) => (x == null ? 0 : Number(x));
  const mapCompany = (c: Record<string, unknown>): CashflowTopCompany => ({
    companyId: (c.company_id as number | null) ?? null,
    companyName: (c.company_name as string | null) ?? null,
    totalOverdueMxn: num(c.total_overdue_mxn),
    nInvoices: num(c.n_invoices),
    maxDaysOverdue: num(c.max_days_overdue),
    avgDaysOverdue: num(c.avg_days_overdue),
    collectionProbability14d: c.collection_probability_14d != null ? num(c.collection_probability_14d) : undefined,
    expectedCollection14dMxn: c.expected_collection_14d_mxn != null ? num(c.expected_collection_14d_mxn) : undefined,
  });
  return {
    computedAt: r.computed_at,
    metrics: {
      effectiveCashMxn: num(r.metrics.effective_cash_mxn),
      apOverdueMxn: num(r.metrics.ap_overdue_mxn),
      arOverdueMxn: num(r.metrics.ar_overdue_mxn),
      liquidityGapMxn: num(r.metrics.liquidity_gap_mxn),
      apOverdueCoverageRatio: r.metrics.ap_overdue_coverage_ratio != null ? num(r.metrics.ap_overdue_coverage_ratio) : null,
      runwayWeeksRecurring: r.metrics.runway_weeks_recurring != null ? num(r.metrics.runway_weeks_recurring) : null,
      burnRateWeeklyMxn: num(r.metrics.burn_rate_weekly_mxn),
      payrollQuincenalMxn: num(r.metrics.payroll_quincenal_mxn),
      opexWeeklyMxn: num(r.metrics.opex_weekly_mxn),
      taxWeeklyMxn: num(r.metrics.tax_weekly_mxn),
    },
    topArToCollect: (r.top_ar_to_collect || []).map(mapCompany),
    topApToNegotiate: (r.top_ap_to_negotiate || []).map(mapCompany),
    actions: (r.actions || []).map((a) => ({
      priority: num(a.priority),
      severity: (a.severity as RecommendationSeverity) || 'MEDIUM',
      category: (a.category as string) || '',
      title: (a.title as string) || '',
      rationale: (a.rationale as string) || '',
      action: (a.action as string) || '',
      impactMxn: num(a.impact_mxn),
    })),
  };
}
