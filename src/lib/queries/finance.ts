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

/** Saldo bancario (view: cash_position) */
export interface BankBalance {
  banco: string | null;
  tipo: string | null;
  moneda: string | null;
  cuenta: string | null;
  saldo: number;
}

export async function getCashPosition(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cash_position")
    .select("banco, tipo, moneda, cuenta, saldo")
    .order("saldo", { ascending: false });
  return ((data ?? []) as Array<
    Omit<BankBalance, "saldo"> & { saldo: number | null }
  >).map((r) => ({
    ...r,
    saldo: Number(r.saldo) || 0,
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
 * Projected Cash Flow v2 (view: projected_cash_flow_weekly + RPC
 * get_projected_cash_flow_summary + view projected_cash_flow_top_ar_by_week).
 *
 * Devuelve 13 semanas de proyección con entradas/salidas/running balance, top
 * contribuyentes de CxC por semana, y 3 escenarios agregados (base, optimistic,
 * conservative) para stress-test del CEO.
 *
 * Migration: `20260415_projected_cash_flow_v2.sql`.
 */
export interface ProjectedCashFlowWeek {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  arCommitted: number;
  arOverdue: number;
  soPipeline: number;
  apCommitted: number;
  apOverdue: number;
  poPipeline: number;
  payrollEstimated: number;
  opexRecurring: number;
  inflowsTotal: number;
  outflowsTotal: number;
  netFlow: number;
  openingBalance: number;
  closingBalance: number;
}

export interface ProjectedCashFlowTopAr {
  weekIndex: number;
  rank: number;
  companyId: string | null;
  companyName: string | null;
  totalAmount: number;
  invoicesCount: number;
}

export interface ProjectedCashFlowSummary {
  cashNow: number;
  totalInflows13w: number;
  totalOutflows13w: number;
  netFlow13w: number;
  minClosingBalance: number;
  maxClosingBalance: number;
  firstNegativeWeek: {
    weekIndex: number;
    weekStart: string;
    closingBalance: number;
  } | null;
  arOverdueToday: number;
  apOverdueToday: number;
  scenarioBaseMin: number;
  scenarioOptimisticMin: number;
  scenarioConservativeMin: number;
  computedAt: string | null;
}

export interface ProjectedCashFlow {
  summary: ProjectedCashFlowSummary | null;
  weeks: ProjectedCashFlowWeek[];
  topArByWeek: ProjectedCashFlowTopAr[];
}

type RawWeek = {
  week_index: number | null;
  week_start: string | null;
  week_end: string | null;
  ar_committed: number | null;
  ar_overdue: number | null;
  so_pipeline: number | null;
  ap_committed: number | null;
  ap_overdue: number | null;
  po_pipeline: number | null;
  payroll_estimated: number | null;
  opex_recurring: number | null;
  inflows_total: number | null;
  outflows_total: number | null;
  net_flow: number | null;
  opening_balance: number | null;
  closing_balance: number | null;
};

type RawTopAr = {
  week_index: number | null;
  rank: number | null;
  company_id: string | null;
  company_name: string | null;
  total_amount: number | null;
  invoices_count: number | null;
};

function mapWeek(r: RawWeek): ProjectedCashFlowWeek {
  return {
    weekIndex: Number(r.week_index) || 0,
    weekStart: r.week_start ?? "",
    weekEnd: r.week_end ?? "",
    arCommitted: Number(r.ar_committed) || 0,
    arOverdue: Number(r.ar_overdue) || 0,
    soPipeline: Number(r.so_pipeline) || 0,
    apCommitted: Number(r.ap_committed) || 0,
    apOverdue: Number(r.ap_overdue) || 0,
    poPipeline: Number(r.po_pipeline) || 0,
    payrollEstimated: Number(r.payroll_estimated) || 0,
    opexRecurring: Number(r.opex_recurring) || 0,
    inflowsTotal: Number(r.inflows_total) || 0,
    outflowsTotal: Number(r.outflows_total) || 0,
    netFlow: Number(r.net_flow) || 0,
    openingBalance: Number(r.opening_balance) || 0,
    closingBalance: Number(r.closing_balance) || 0,
  };
}

export async function getProjectedCashFlow(): Promise<ProjectedCashFlow> {
  const sb = getServiceClient();
  const [{ data: weeksRaw }, { data: summaryRaw }, { data: topArRaw }] =
    await Promise.all([
      sb
        .from("projected_cash_flow_weekly")
        .select("*")
        .order("week_index", { ascending: true }),
      sb.rpc("get_projected_cash_flow_summary"),
      sb
        .from("projected_cash_flow_top_ar_by_week")
        .select("*")
        .order("week_index", { ascending: true })
        .order("rank", { ascending: true }),
    ]);

  const weeks = ((weeksRaw ?? []) as RawWeek[]).map(mapWeek);

  const topArByWeek = ((topArRaw ?? []) as RawTopAr[]).map((r) => ({
    weekIndex: Number(r.week_index) || 0,
    rank: Number(r.rank) || 0,
    companyId: r.company_id,
    companyName: r.company_name,
    totalAmount: Number(r.total_amount) || 0,
    invoicesCount: Number(r.invoices_count) || 0,
  }));

  const s = (summaryRaw ?? null) as {
    cash_now: number | null;
    total_inflows_13w: number | null;
    total_outflows_13w: number | null;
    net_flow_13w: number | null;
    min_closing_balance: number | null;
    max_closing_balance: number | null;
    first_negative_week: {
      week_index: number;
      week_start: string;
      closing_balance: number;
    } | null;
    ar_overdue_today: number | null;
    ap_overdue_today: number | null;
    scenario_base_min: number | null;
    scenario_optimistic_min: number | null;
    scenario_conservative_min: number | null;
    computed_at: string | null;
  } | null;

  const summary: ProjectedCashFlowSummary | null = s
    ? {
        cashNow: Number(s.cash_now) || 0,
        totalInflows13w: Number(s.total_inflows_13w) || 0,
        totalOutflows13w: Number(s.total_outflows_13w) || 0,
        netFlow13w: Number(s.net_flow_13w) || 0,
        minClosingBalance: Number(s.min_closing_balance) || 0,
        maxClosingBalance: Number(s.max_closing_balance) || 0,
        firstNegativeWeek: s.first_negative_week
          ? {
              weekIndex: Number(s.first_negative_week.week_index) || 0,
              weekStart: String(s.first_negative_week.week_start ?? ""),
              closingBalance:
                Number(s.first_negative_week.closing_balance) || 0,
            }
          : null,
        arOverdueToday: Number(s.ar_overdue_today) || 0,
        apOverdueToday: Number(s.ap_overdue_today) || 0,
        scenarioBaseMin: Number(s.scenario_base_min) || 0,
        scenarioOptimisticMin: Number(s.scenario_optimistic_min) || 0,
        scenarioConservativeMin: Number(s.scenario_conservative_min) || 0,
        computedAt: s.computed_at,
      }
    : null;

  return { summary, weeks, topArByWeek };
}
