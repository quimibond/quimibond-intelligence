import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F3 — P&L KPIs + waterfall for a given HistoryRange.
 *
 * Single source of truth: canonical_account_balances con filtros por
 * account_code prefix (para ingresos) y account_type por-row (para egresos).
 * Nunca usamos gold_pl_statement.by_level_1 — agrupa a prefix y pierde la
 * distinción entre expense_direct_cost y expense_depreciation dentro del
 * mismo prefijo (504.01 vs 504.08-23).
 *
 * Breakdown por cuenta para "P&L limpio con costo primo real":
 *   501.01  Cost of sales (debería ser solo MP; residuo vs BOM = CAPA pendiente)
 *   501.06  Mano de obra directa
 *   502     Compras importación
 *   504.01  Overhead fábrica (renta, energía, servicios)
 *   504.08-23 Depreciación fábrica
 *   6xx     Gastos operativos admin/ventas
 *   613     Depreciación CORPO
 *
 * SIGN CONVENTION (Mexican chart of accounts):
 * - income accounts  → balance stored NEGATIVE → negate for display
 * - expense accounts → balance stored POSITIVE → keep as-is
 */
export interface PnlKpis {
  period: HistoryRange;
  periodLabel: string;
  // Ingresos
  ingresosPl: number; // cuenta 4xx — ventas de producto
  otrosIngresosNetoMxn: number; // cuenta 7xx neto
  ingresosSat: number;
  // COGS totales (legacy — suma de todas las expense_direct_cost)
  costoVentas: number;
  // COGS breakdown por cuenta
  cogs501_01Mxn: number; // Cost of sales (debería ser solo MP)
  mod501_06Mxn: number; // Mano de obra directa
  compras502Mxn: number; // Compras importación
  overhead504_01Mxn: number; // Overhead fábrica
  depFabrica504Mxn: number; // Depreciación maquinaria/edificio fábrica
  // Gastos op
  gastosOperativos: number;
  gastosOp6xxMxn: number; // 6xx expense
  depCorpoMxn: number; // 613 expense_depreciation
  // Totales / derivados
  utilidadBruta: number;
  utilidadNeta: number;
  netIncome: number;
  driftPct: number | null;
  monthsCovered: number;
}

export interface WaterfallPoint {
  label: string;
  value: number;
  kind: "positive" | "negative" | "total";
}

type PeriodWindow = {
  fromMonth: string;
  toMonth: string;
  label: string;
  monthsCovered: number;
};

type RawRow = {
  balance: number | null;
  period: string | null;
  account_code: string | null;
  account_type: string | null;
};

type Aggregates = {
  window: PeriodWindow;
  ventasProducto: number;
  otrosIngresosNeto: number;
  // expense breakdown
  cogs501_01: number;
  mod501_06: number;
  compras502: number;
  overhead504_01: number;
  depFabrica504: number;
  gastosOp6xx: number;
  depCorpo613: number;
};

async function fetchPlAggregates(range: HistoryRange): Promise<Aggregates> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const toMonth = bounds.toMonth.slice(0, 7);

  // Two queries cover everything: all income + all expense rows for the period.
  // Split by account_code + account_type locally. Cheap (~230 rows/mes × N meses).
  const [incRes, expRes] = await Promise.all([
    sb
      .from("canonical_account_balances")
      .select("balance, period, account_code, account_type")
      .eq("balance_sheet_bucket", "income")
      .eq("deprecated", false)
      .gte("period", bounds.fromMonth)
      .lte("period", toMonth),
    sb
      .from("canonical_account_balances")
      .select("balance, period, account_code, account_type")
      .eq("balance_sheet_bucket", "expense")
      .eq("deprecated", false)
      .gte("period", bounds.fromMonth)
      .lte("period", toMonth),
  ]);

  const incRows = (incRes.data ?? []) as RawRow[];
  const expRows = (expRes.data ?? []) as RawRow[];

  // Ingresos split por account_code prefix
  let ventasProducto = 0;
  let otrosIngresosNeto = 0;
  for (const r of incRows) {
    const bal = Number(r.balance) || 0;
    const code = r.account_code ?? "";
    if (code.startsWith("4")) ventasProducto -= bal; // negate (stored credit)
    else if (code.startsWith("7")) otrosIngresosNeto -= bal;
  }

  // Expenses split por prefix + account_type individual
  let cogs501_01 = 0;
  let mod501_06 = 0;
  let compras502 = 0;
  let overhead504_01 = 0;
  let depFabrica504 = 0;
  let gastosOp6xx = 0;
  let depCorpo613 = 0;

  for (const r of expRows) {
    const bal = Number(r.balance) || 0;
    const code = r.account_code ?? "";
    const type = r.account_type ?? "";
    if (code.startsWith("501.01")) cogs501_01 += bal;
    else if (code.startsWith("501.06")) mod501_06 += bal;
    else if (code.startsWith("502")) compras502 += bal;
    else if (code.startsWith("504")) {
      if (type === "expense_depreciation") depFabrica504 += bal;
      else overhead504_01 += bal; // 504.01.xxxx
    } else if (code.startsWith("6")) {
      if (type === "expense_depreciation") depCorpo613 += bal;
      else gastosOp6xx += bal;
    } else {
      // Fallback: cuentas 5xx restantes que no cumplan arriba van a gastos op
      // por tipo. Esto cubre cualquier cuenta nueva sin explotar el P&L.
      if (type === "expense_direct_cost") cogs501_01 += bal;
      else if (type === "expense_depreciation") depCorpo613 += bal;
      else gastosOp6xx += bal;
    }
  }

  // monthsCovered = distinct periods seen
  const periods = new Set<string>();
  for (const r of [...incRows, ...expRows]) {
    if (r.period) periods.add(r.period);
  }

  return {
    window: {
      fromMonth: bounds.fromMonth,
      toMonth: bounds.toMonth,
      label: bounds.label,
      monthsCovered: periods.size,
    },
    ventasProducto,
    otrosIngresosNeto,
    cogs501_01,
    mod501_06,
    compras502,
    overhead504_01,
    depFabrica504,
    gastosOp6xx,
    depCorpo613,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function deriveTotals(agg: Aggregates) {
  const costoVentas =
    agg.cogs501_01 +
    agg.mod501_06 +
    agg.compras502 +
    agg.overhead504_01 +
    agg.depFabrica504;
  const gastosOperativos = agg.gastosOp6xx + agg.depCorpo613;
  const utilidadBruta = agg.ventasProducto - costoVentas;
  const utilidadNeta =
    agg.ventasProducto +
    agg.otrosIngresosNeto -
    costoVentas -
    gastosOperativos;
  return { costoVentas, gastosOperativos, utilidadBruta, utilidadNeta };
}

async function _getPnlKpisRaw(range: HistoryRange): Promise<PnlKpis> {
  const sb = getServiceClient();
  const agg = await fetchPlAggregates(range);
  const t = deriveTotals(agg);

  // SAT revenue for the same window (emitidas dentro del rango)
  const bounds = periodBoundsForRange(range);
  const { data: satData, error: satErr } = await sb
    .from("canonical_invoices")
    .select(
      "amount_total_mxn_sat, amount_total_mxn_resolved, amount_total_mxn_odoo, invoice_date"
    )
    .eq("direction", "issued")
    .neq("estado_sat", "cancelado")
    .gte("invoice_date", bounds.from)
    .lt("invoice_date", bounds.to);
  if (satErr) {
    console.error("[getPnlKpis] SAT aggregation failure", satErr.message);
  }
  type SatRow = {
    amount_total_mxn_sat: number | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const ingresosSat = (satData ?? []).reduce(
    (s, r) =>
      s +
      (Number(
        (r as SatRow).amount_total_mxn_sat ??
          (r as SatRow).amount_total_mxn_resolved ??
          (r as SatRow).amount_total_mxn_odoo
      ) || 0),
    0
  );

  const maxSide = Math.max(agg.ventasProducto, ingresosSat);
  const driftPct =
    maxSide > 0
      ? Math.round((Math.abs(agg.ventasProducto - ingresosSat) / maxSide) * 1000) / 10
      : null;

  return {
    period: range,
    periodLabel: agg.window.label,
    ingresosPl: round2(agg.ventasProducto),
    otrosIngresosNetoMxn: round2(agg.otrosIngresosNeto),
    ingresosSat: round2(ingresosSat),
    costoVentas: round2(t.costoVentas),
    cogs501_01Mxn: round2(agg.cogs501_01),
    mod501_06Mxn: round2(agg.mod501_06),
    compras502Mxn: round2(agg.compras502),
    overhead504_01Mxn: round2(agg.overhead504_01),
    depFabrica504Mxn: round2(agg.depFabrica504),
    gastosOperativos: round2(t.gastosOperativos),
    gastosOp6xxMxn: round2(agg.gastosOp6xx),
    depCorpoMxn: round2(agg.depCorpo613),
    utilidadBruta: round2(t.utilidadBruta),
    utilidadNeta: round2(t.utilidadNeta),
    netIncome: round2(t.utilidadNeta),
    monthsCovered: agg.window.monthsCovered,
    driftPct,
  };
}

export async function getPnlKpis(range: HistoryRange): Promise<PnlKpis> {
  return _getPnlKpisRaw(range);
}

export async function getPnlWaterfall(
  range: HistoryRange
): Promise<WaterfallPoint[]> {
  const agg = await fetchPlAggregates(range);
  const t = deriveTotals(agg);
  const ebit = t.utilidadBruta - t.gastosOperativos;
  return [
    { label: "Ventas de producto", value: round2(agg.ventasProducto), kind: "positive" },
    { label: "COGS", value: round2(-t.costoVentas), kind: "negative" },
    { label: "Utilidad bruta", value: round2(t.utilidadBruta), kind: "total" },
    { label: "Gastos op.", value: round2(-t.gastosOperativos), kind: "negative" },
    { label: "EBIT", value: round2(ebit), kind: "total" },
    {
      label: "Otros ingresos",
      value: round2(agg.otrosIngresosNeto),
      kind: agg.otrosIngresosNeto >= 0 ? "positive" : "negative",
    },
    { label: "Utilidad neta", value: round2(t.utilidadNeta), kind: "total" },
  ];
}
