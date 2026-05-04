import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getPnlKpis, type PnlKpis } from "./pnl";
import { getCogsComparison, type CogsComparison } from "./cogs-adjusted";
import { getPnlNormalized, type PnlNormalizedSummary } from "./pnl-normalized";

/**
 * Reporte mensual de cierre (apto para print/PDF).
 *
 * Agrega los datos de un mes específico (period = "YYYY-MM"):
 *   - P&L limpio current vs prior month con delta por cuenta
 *   - Drivers de revenue por cliente (top winners/losers)
 *   - Drivers de gasto por cuenta GL
 *   - One-offs detectados y utilidad normalizada
 *   - Cash position + AR/AP
 *
 * Esto NO incluye la narrativa CFO — eso se genera aparte vía Claude API
 * en `monthly-report-narrative.ts` (consumiendo este snapshot como input).
 */

export interface PnlMonthSnapshot {
  ventas4xx: number;
  cogs501_01: number;
  cogsRecursivoMp: number;
  mod501_06: number;
  compras502: number;
  overhead504_01: number;
  costoVentasContable: number;     // 501 + 502 + 504.01
  costoVentasLimpio: number;       // BOM + 501.06 + 502 + 504.01
  gastosOp6xx: number;
  ebitContable: number;
  ebitLimpio: number;
  otros7xx: number;                 // negative if loss
  depreciacion: number;             // 504.08-23 + 613
  utilidadContable: number;
  utilidadLimpia: number;
  capaResidual: number;             // = cogs501_01 - cogsRecursivoMp
}

export interface RevenueDriver {
  companyId: number;
  companyName: string;
  revenueCurr: number;
  revenuePrev: number;
  delta: number;
  isOneOff: boolean;
}

export interface AccountDriver {
  accountCode: string;
  accountName: string;
  bucket: string;
  currBalance: number;
  prevBalance: number;
  delta: number;          // impacto en utilidad (positivo = mejora)
}

export interface MonthlyReport {
  period: string;
  periodLabel: string;
  periodPrev: string;
  periodPrevLabel: string;
  generatedAt: string;
  pnl: {
    curr: PnlMonthSnapshot;
    prev: PnlMonthSnapshot;
  };
  customerGainers: RevenueDriver[];
  customerLosers: RevenueDriver[];
  accountHelpers: AccountDriver[];   // δ utilidad > 0
  accountHurters: AccountDriver[];   // δ utilidad < 0
  oneOffs: PnlNormalizedSummary["adjustments"];
  utilidadNormalizada: number;
  cashOpening: number;
  arOpen: number;
  apOpen: number;
  fxNetMxn: number;
  arrendamientoFinancieroMxn: number;
}

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

function priorPeriod(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildPnlSnapshot(
  kpis: PnlKpis,
  cogs: CogsComparison
): PnlMonthSnapshot {
  const ventas = kpis.ingresosPl;
  const cogs501_01 = kpis.cogs501_01Mxn;
  const cogsBom = cogs.cogsRecursiveMpMxn;
  const mod = kpis.mod501_06Mxn;
  const compras = kpis.compras502Mxn;
  const overhead = kpis.overhead504_01Mxn;
  const gastosOp = kpis.gastosOp6xxMxn;
  const otros = kpis.otrosIngresosNetoMxn;
  const dep = kpis.depreciacionTotalMxn;

  const costoContable = cogs501_01 + mod + compras + overhead;
  const costoLimpio = cogsBom + mod + compras + overhead;
  const ebitContable = ventas - costoContable - gastosOp;
  const ebitLimpio = ventas - costoLimpio - gastosOp;
  const utilContable = ebitContable + otros - dep;
  const utilLimpio = ebitLimpio + otros - dep;

  return {
    ventas4xx: ventas,
    cogs501_01,
    cogsRecursivoMp: cogsBom,
    mod501_06: mod,
    compras502: compras,
    overhead504_01: overhead,
    costoVentasContable: costoContable,
    costoVentasLimpio: costoLimpio,
    gastosOp6xx: gastosOp,
    ebitContable,
    ebitLimpio,
    otros7xx: otros,
    depreciacion: dep,
    utilidadContable: utilContable,
    utilidadLimpia: utilLimpio,
    capaResidual: cogs501_01 - cogsBom,
  };
}

async function _getMonthlyReportRaw(period: string): Promise<MonthlyReport> {
  const sb = getServiceClient();
  const prev = priorPeriod(period);
  const range = `m:${period}` as const;
  const prevRange = `m:${prev}` as const;

  const [
    kpisCurr,
    kpisPrev,
    cogsCurr,
    cogsPrev,
    normalized,
    revDriversRes,
    acctDriversRes,
    bankRes,
    arRes,
    apRes,
  ] = await Promise.all([
    getPnlKpis(range),
    getPnlKpis(prevRange),
    getCogsComparison(range),
    getCogsComparison(prevRange),
    getPnlNormalized(range),
    sb.rpc("get_mom_revenue_drivers", { p_period: period }),
    sb.rpc("get_mom_pnl_account_drivers", { p_period: period }),
    sb
      .from("canonical_bank_balances")
      .select("current_balance_mxn, classification")
      .eq("classification", "cash"),
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_resolved")
      .eq("direction", "issued")
      .eq("is_quimibond_relevant", true)
      .gt("amount_residual_mxn_resolved", 0),
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_resolved")
      .eq("direction", "received")
      .eq("is_quimibond_relevant", true)
      .gt("amount_residual_mxn_resolved", 0),
  ]);

  const pnlCurr = buildPnlSnapshot(kpisCurr, cogsCurr);
  const pnlPrev = buildPnlSnapshot(kpisPrev, cogsPrev);

  type RevRpc = {
    company_canonical_id: number;
    company_name: string;
    revenue_curr: string | number;
    revenue_prev: string | number;
    delta: string | number;
    is_one_off: boolean;
  };
  const allRevs: RevenueDriver[] = ((revDriversRes.data ?? []) as RevRpc[]).map(
    (r) => ({
      companyId: r.company_canonical_id,
      companyName: r.company_name,
      revenueCurr: Number(r.revenue_curr) || 0,
      revenuePrev: Number(r.revenue_prev) || 0,
      delta: Number(r.delta) || 0,
      isOneOff: Boolean(r.is_one_off),
    })
  );
  const customerGainers = allRevs
    .filter((r) => r.delta > 0 && !r.isOneOff)
    .slice(0, 6);
  const customerLosers = allRevs
    .filter((r) => r.delta < 0 && !r.isOneOff)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 6);

  type AcctRpc = {
    account_code: string;
    account_name: string;
    account_type: string;
    bucket: string;
    curr_balance: string | number;
    prev_balance: string | number;
    delta: string | number;
    is_significant: boolean;
  };
  // Filtrar solo P&L (income + expense), no balance sheet ('otro' bucket).
  const pnlBuckets = new Set([
    "income_4xx",
    "income_7xx",
    "cogs_501_01",
    "mod_501_06",
    "compras_502",
    "overhead_504_01",
    "dep_504_08_23",
    "dep_corpo_613",
    "gastos_op_6xx",
  ]);
  const allAccts: AccountDriver[] = ((acctDriversRes.data ?? []) as AcctRpc[])
    .filter((r) => pnlBuckets.has(r.bucket) && r.is_significant)
    .map((r) => ({
      accountCode: r.account_code,
      accountName: r.account_name,
      bucket: r.bucket,
      currBalance: Number(r.curr_balance) || 0,
      prevBalance: Number(r.prev_balance) || 0,
      delta: Number(r.delta) || 0,
    }));
  const accountHelpers = allAccts
    .filter((a) => a.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);
  const accountHurters = allAccts
    .filter((a) => a.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 6);

  // Cash, AR, AP
  type BankRow = { current_balance_mxn: number | null };
  const cashOpening = ((bankRes.data ?? []) as BankRow[]).reduce(
    (s, r) => s + (Number(r.current_balance_mxn) || 0),
    0
  );
  type ResidualRow = { amount_residual_mxn_resolved: number | null };
  const arOpen = ((arRes.data ?? []) as ResidualRow[]).reduce(
    (s, r) => s + (Number(r.amount_residual_mxn_resolved) || 0),
    0
  );
  const apOpen = ((apRes.data ?? []) as ResidualRow[]).reduce(
    (s, r) => s + (Number(r.amount_residual_mxn_resolved) || 0),
    0
  );

  // FX neto = 701.01.* + 702.01.*  signed contribution to utility
  const fxAccounts = allAccts.filter(
    (a) => a.accountCode.startsWith("701.01") || a.accountCode.startsWith("702.01")
  );
  const fxNetMxn =
    -fxAccounts.reduce((s, a) => s + a.currBalance, 0); // negate stored sign

  // Arrendamiento financiero = 701.11.0001 actual del mes
  const arrend = allAccts.find((a) => a.accountCode === "701.11.0001");
  const arrendamientoFinancieroMxn = arrend
    ? -arrend.currBalance // contribution to utility (negative if loss)
    : 0;

  const detectedOneOffs = normalized.adjustments.filter((a) => a.detected);
  const utilidadNormalizada =
    pnlCurr.utilidadLimpia +
    detectedOneOffs.reduce((s, a) => s + a.impactOnUtilityMxn, 0);

  return {
    period,
    periodLabel: periodLabel(period),
    periodPrev: prev,
    periodPrevLabel: periodLabel(prev),
    generatedAt: new Date().toISOString(),
    pnl: { curr: pnlCurr, prev: pnlPrev },
    customerGainers,
    customerLosers,
    accountHelpers,
    accountHurters,
    oneOffs: detectedOneOffs,
    utilidadNormalizada,
    cashOpening,
    arOpen,
    apOpen,
    fxNetMxn,
    arrendamientoFinancieroMxn,
  };
}

export const getMonthlyReport = (period: string) =>
  unstable_cache(
    () => _getMonthlyReportRaw(period),
    ["sp13-finanzas-monthly-report-v1", period],
    { revalidate: 600, tags: ["finanzas"] }
  )();
