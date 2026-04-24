import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F3 — P&L KPIs + waterfall for a given HistoryRange.
 *
 * Sources:
 * - canonical_account_balances — split by account_code prefix:
 *     4xx → ventas de producto (ingresos de verdad)
 *     7xx → otros ingresos netos (FX, intereses, venta de activo, pérdidas financieras)
 *   Mezclarlos distorsiona el margen. En marzo 2026 se vendió una máquina
 *   que entró en 7xx (utilidad) por $574k pero cuya factura era $11.35M —
 *   si sumamos todo en "ingresos" el margen se infla artificialmente.
 * - gold_pl_statement — sólo para expense_direct_cost y net_income breakdown
 *   (cuando by_level_1 está disponible). Para totales usamos balances directos.
 * - canonical_invoices (SAT revenue for the same window; drift detection)
 *
 * SIGN CONVENTION (Mexican chart of accounts in canonical_account_balances):
 * - income accounts  → balance stored NEGATIVE (credit side) → negate for display
 * - expense accounts → balance stored POSITIVE (debit side) → keep as-is
 * - gold_pl_statement.net_income = total_income + total_expense
 *   → POSITIVE value in that column means LOSS
 *   → NEGATIVE value in that column means PROFIT
 *
 * For UI presentation we flip the sign so "utilidad neta" follows normal
 * CFO convention: positive = profit, negative = loss.
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

type PlRow = {
  period: string | null;
  total_income: number | null;
  total_expense: number | null;
  net_income: number | null;
  by_level_1: Record<string, { balance: number; account_type: string }> | null;
};

async function fetchPlWindow(
  range: HistoryRange
): Promise<{
  rows: PlRow[];
  fromMonth: string;
  toMonth: string;
  label: string;
}> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const { data, error } = await sb
    .from("gold_pl_statement")
    .select("period, total_income, total_expense, net_income, by_level_1")
    .gte("period", bounds.fromMonth)
    .lte("period", bounds.toMonth.slice(0, 7))
    .order("period", { ascending: true });
  if (error) {
    console.error("[fetchPlWindow] query failure", error.message);
  }
  return {
    rows: (data ?? []) as PlRow[],
    fromMonth: bounds.fromMonth,
    toMonth: bounds.toMonth,
    label: bounds.label,
  };
}

type RevenueSplit = { ventasProducto: number; otrosIngresosNeto: number };

function aggregatePl(
  rows: PlRow[],
  revenue: RevenueSplit
): Omit<PnlKpis, "period" | "periodLabel" | "ingresosSat" | "driftPct"> {
  let costoVentas = 0;
  let gastosOperativos = 0;
  let netIncomeStored = 0;
  for (const r of rows) {
    netIncomeStored += Number(r.net_income) || 0;
    if (r.by_level_1) {
      for (const entry of Object.values(r.by_level_1)) {
        const bal = Number(entry.balance) || 0;
        if (entry.account_type === "expense_direct_cost") costoVentas += bal;
        else if (entry.account_type === "expense" || entry.account_type === "expense_depreciation")
          gastosOperativos += bal;
      }
    } else {
      const exp = Math.max(0, Number(r.total_expense) || 0);
      costoVentas += exp * 0.7;
      gastosOperativos += exp * 0.3;
    }
  }
  // Flip sign: stored net_income is positive-for-loss. Display as
  // profit-positive / loss-negative.
  const utilidadNeta = -netIncomeStored;
  return {
    ingresosPl: Math.round(revenue.ventasProducto * 100) / 100,
    otrosIngresosNetoMxn: Math.round(revenue.otrosIngresosNeto * 100) / 100,
    costoVentas: Math.round(costoVentas * 100) / 100,
    gastosOperativos: Math.round(gastosOperativos * 100) / 100,
    utilidadBruta: Math.round((revenue.ventasProducto - costoVentas) * 100) / 100,
    utilidadNeta: Math.round(utilidadNeta * 100) / 100,
    netIncome: Math.round(utilidadNeta * 100) / 100,
    monthsCovered: rows.length,
  };
}

async function fetchRevenueSplit(range: HistoryRange): Promise<RevenueSplit> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const toMonth = bounds.toMonth.slice(0, 7);
  // Ventas de producto (4xx) — denominador de margen.
  const rev4 = sb
    .from("canonical_account_balances")
    .select("balance")
    .eq("balance_sheet_bucket", "income")
    .eq("deprecated", false)
    .like("account_code", "4%")
    .gte("period", bounds.fromMonth)
    .lte("period", toMonth);
  // Otros ingresos/gastos financieros (7xx): ganancia y pérdida cambiaria,
  // intereses, utilidad/pérdida en venta de activo. Reportados como neto.
  const rev7 = sb
    .from("canonical_account_balances")
    .select("balance")
    .eq("balance_sheet_bucket", "income")
    .eq("deprecated", false)
    .like("account_code", "7%")
    .gte("period", bounds.fromMonth)
    .lte("period", toMonth);
  const [{ data: d4 }, { data: d7 }] = await Promise.all([rev4, rev7]);
  type R = { balance: number | null };
  const sum = (arr: R[] | null) =>
    -(arr ?? []).reduce((s, r) => s + (Number(r.balance) || 0), 0);
  return {
    ventasProducto: sum(d4 as R[] | null),
    otrosIngresosNeto: sum(d7 as R[] | null),
  };
}

async function _getPnlKpisRaw(range: HistoryRange): Promise<PnlKpis> {
  const sb = getServiceClient();
  const [{ rows, fromMonth, toMonth, label }, revenue] = await Promise.all([
    fetchPlWindow(range),
    fetchRevenueSplit(range),
  ]);
  const pl = aggregatePl(rows, revenue);

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

  const maxSide = Math.max(pl.ingresosPl, ingresosSat);
  const driftPct =
    maxSide > 0
      ? Math.round((Math.abs(pl.ingresosPl - ingresosSat) / maxSide) * 1000) / 10
      : null;

  // fromMonth/toMonth calculated for debugging reference (unused but reserved)
  void fromMonth; void toMonth;

  return {
    ...pl,
    period: range,
    periodLabel: label,
    ingresosSat: Math.round(ingresosSat * 100) / 100,
    driftPct,
  };
}

export async function getPnlKpis(range: HistoryRange): Promise<PnlKpis> {
  return _getPnlKpisRaw(range);
}

export async function getPnlWaterfall(
  range: HistoryRange
): Promise<WaterfallPoint[]> {
  const [{ rows }, revenue] = await Promise.all([
    fetchPlWindow(range),
    fetchRevenueSplit(range),
  ]);
  const pl = aggregatePl(rows, revenue);
  const ebit = pl.utilidadBruta - pl.gastosOperativos;
  // Residual = net income - (EBIT + other income). Cubre ISR/PTU/imp. diferidos.
  const residual = pl.netIncome - ebit - pl.otrosIngresosNetoMxn;
  return [
    { label: "Ventas de producto", value: pl.ingresosPl, kind: "positive" },
    { label: "COGS", value: -pl.costoVentas, kind: "negative" },
    { label: "Utilidad bruta", value: pl.utilidadBruta, kind: "total" },
    { label: "Gastos op.", value: -pl.gastosOperativos, kind: "negative" },
    { label: "EBIT", value: ebit, kind: "total" },
    {
      label: "Otros ingresos",
      value: pl.otrosIngresosNetoMxn,
      kind: pl.otrosIngresosNetoMxn >= 0 ? "positive" : "negative",
    },
    {
      label: "Impuestos/otros",
      value: residual,
      kind: residual >= 0 ? "positive" : "negative",
    },
    { label: "Utilidad neta", value: pl.netIncome, kind: "total" },
  ];
}
