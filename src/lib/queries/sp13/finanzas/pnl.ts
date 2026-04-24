import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F3 — P&L KPIs + waterfall for a given HistoryRange.
 *
 * Sources (todo desde canonical_account_balances — una sola verdad):
 * - Ingresos split por account_code prefix:
 *     4xx → ventas de producto (ingresos de verdad)
 *     7xx → otros ingresos netos (FX, intereses, venta de activo, pérdidas financieras)
 * - COGS y gastos op split por account_type individual:
 *     expense_direct_cost  → COGS
 *     expense              → gastos operativos
 *     expense_depreciation → gastos operativos (incluye 504.08/09/10/11/23
 *                            depreciación maquinaria + amortización instalaciones
 *                            que erroneamente `gold_pl_statement.by_level_1`
 *                            agrupa bajo 504 como expense_direct_cost. Ese
 *                            agregado prefix-level perdía el type real y
 *                            sumaba $435k/mes al COGS en marzo 2026).
 * - net_income se deriva localmente de (4xx + 7xx) − (cogs + opex); NO se
 *   toma de gold_pl_statement para evitar drift.
 * - canonical_invoices (SAT revenue for the same window; drift detection).
 *
 * SIGN CONVENTION (Mexican chart of accounts):
 * - income accounts  → balance stored NEGATIVE (credit) → negate for display
 * - expense accounts → balance stored POSITIVE (debit) → keep as-is
 */
export interface PnlKpis {
  period: HistoryRange;
  periodLabel: string;
  ingresosPl: number; // ventas de producto (cuenta 4xx) — denominador de margen
  otrosIngresosNetoMxn: number; // neto de cuenta 7xx (gains - losses financieros/otros)
  ingresosSat: number;
  costoVentas: number;
  gastosOperativos: number;
  utilidadBruta: number;
  utilidadNeta: number;
  netIncome: number;
  driftPct: number | null; // abs((pl − sat) / max(pl,sat)) × 100
  monthsCovered: number;
}

export interface WaterfallPoint {
  label: string;
  value: number;
  kind: "positive" | "negative" | "total";
}

type PeriodWindow = {
  fromMonth: string;
  toMonth: string; // YYYY-MM inclusive
  label: string;
  monthsCovered: number;
};

type RawRow = { balance: number | null; period: string | null };

/**
 * Single-source aggregate: lee canonical_account_balances con filtros por
 * account_code prefix (para ingresos) y account_type (para egresos). No
 * usa `gold_pl_statement.by_level_1` porque agrupa a nivel prefix y pierde
 * la distinción entre expense_direct_cost y expense_depreciation dentro
 * del mismo prefijo (ej. 504.01.xxx vs 504.08/09/10/11/23).
 */
async function fetchPlAggregates(range: HistoryRange): Promise<{
  window: PeriodWindow;
  ventasProducto: number;
  otrosIngresosNeto: number;
  costoVentas: number;
  gastosOperativos: number;
}> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const toMonth = bounds.toMonth.slice(0, 7);
  const base = () =>
    sb
      .from("canonical_account_balances")
      .select("balance, period")
      .eq("deprecated", false)
      .gte("period", bounds.fromMonth)
      .lte("period", toMonth);

  const [rev4Res, rev7Res, cogsRes, opexExpenseRes, opexDepRes] = await Promise.all([
    base().eq("balance_sheet_bucket", "income").like("account_code", "4%"),
    base().eq("balance_sheet_bucket", "income").like("account_code", "7%"),
    base().eq("account_type", "expense_direct_cost"),
    base().eq("account_type", "expense"),
    base().eq("account_type", "expense_depreciation"),
  ]);

  const sumBal = (rows: RawRow[] | null, negate = false) =>
    (rows ?? []).reduce((s, r) => s + (Number(r.balance) || 0), 0) *
    (negate ? -1 : 1);

  const ventasProducto = sumBal(rev4Res.data as RawRow[] | null, true);
  const otrosIngresosNeto = sumBal(rev7Res.data as RawRow[] | null, true);
  const costoVentas = sumBal(cogsRes.data as RawRow[] | null);
  const gastosOperativos =
    sumBal(opexExpenseRes.data as RawRow[] | null) +
    sumBal(opexDepRes.data as RawRow[] | null);

  // monthsCovered = distinct periods seen in ANY of the queries
  const periods = new Set<string>();
  for (const res of [rev4Res, rev7Res, cogsRes, opexExpenseRes, opexDepRes]) {
    for (const r of (res.data ?? []) as RawRow[]) {
      if (r.period) periods.add(r.period);
    }
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
    costoVentas,
    gastosOperativos,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function _getPnlKpisRaw(range: HistoryRange): Promise<PnlKpis> {
  const sb = getServiceClient();
  const agg = await fetchPlAggregates(range);

  // SAT revenue for the same window (emitidas dentro del rango)
  const bounds = periodBoundsForRange(range);
  const { data: satData, error: satErr } = await sb
    .from("canonical_invoices")
    .select("amount_total_mxn_sat, amount_total_mxn_resolved, amount_total_mxn_odoo, invoice_date")
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

  const utilidadBruta = agg.ventasProducto - agg.costoVentas;
  // net_income = ingresos totales − gastos totales. Reconstruido local en
  // vez de leerse de gold_pl_statement (que no separa 504 depreciation
  // correctamente). Positivo = utilidad, negativo = pérdida.
  const utilidadNeta =
    agg.ventasProducto +
    agg.otrosIngresosNeto -
    agg.costoVentas -
    agg.gastosOperativos;

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
    costoVentas: round2(agg.costoVentas),
    gastosOperativos: round2(agg.gastosOperativos),
    utilidadBruta: round2(utilidadBruta),
    utilidadNeta: round2(utilidadNeta),
    netIncome: round2(utilidadNeta),
    monthsCovered: agg.window.monthsCovered,
    ingresosSat: round2(ingresosSat),
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
  const utilidadBruta = agg.ventasProducto - agg.costoVentas;
  const ebit = utilidadBruta - agg.gastosOperativos;
  const utilidadNeta =
    agg.ventasProducto +
    agg.otrosIngresosNeto -
    agg.costoVentas -
    agg.gastosOperativos;
  return [
    { label: "Ventas de producto", value: round2(agg.ventasProducto), kind: "positive" },
    { label: "COGS", value: round2(-agg.costoVentas), kind: "negative" },
    { label: "Utilidad bruta", value: round2(utilidadBruta), kind: "total" },
    { label: "Gastos op.", value: round2(-agg.gastosOperativos), kind: "negative" },
    { label: "EBIT", value: round2(ebit), kind: "total" },
    {
      label: "Otros ingresos",
      value: round2(agg.otrosIngresosNeto),
      kind: agg.otrosIngresosNeto >= 0 ? "positive" : "negative",
    },
    { label: "Utilidad neta", value: round2(utilidadNeta), kind: "total" },
  ];
}
