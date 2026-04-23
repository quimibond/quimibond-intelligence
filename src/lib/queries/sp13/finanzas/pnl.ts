import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-selector";
import { periodBoundsForRange } from "./_period";

/**
 * F3 — P&L KPIs + waterfall for a given HistoryRange.
 *
 * Sources:
 * - gold_pl_statement (period YYYY-MM, total_income/total_expense/net_income,
 *   by_level_1 JSON with account_type breakdown)
 * - canonical_invoices (SAT revenue for the same window; drift detection)
 */
export interface PnlKpis {
  period: HistoryRange;
  periodLabel: string;
  ingresosPl: number;
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

function aggregatePl(rows: PlRow[]): Omit<PnlKpis, "period" | "periodLabel" | "ingresosSat" | "driftPct"> {
  let ingresos = 0;
  let costoVentas = 0;
  let gastosOperativos = 0;
  let netIncome = 0;
  for (const r of rows) {
    ingresos += Math.abs(Number(r.total_income) || 0);
    netIncome += Number(r.net_income) || 0;
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
  return {
    ingresosPl: Math.round(ingresos * 100) / 100,
    costoVentas: Math.round(costoVentas * 100) / 100,
    gastosOperativos: Math.round(gastosOperativos * 100) / 100,
    utilidadBruta: Math.round((ingresos - costoVentas) * 100) / 100,
    utilidadNeta: Math.round(netIncome * 100) / 100,
    netIncome: Math.round(netIncome * 100) / 100,
    monthsCovered: rows.length,
  };
}

async function _getPnlKpisRaw(range: HistoryRange): Promise<PnlKpis> {
  const sb = getServiceClient();
  const { rows, fromMonth, toMonth, label } = await fetchPlWindow(range);
  const pl = aggregatePl(rows);

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
  const { rows } = await fetchPlWindow(range);
  const pl = aggregatePl(rows);
  const ebit = pl.utilidadBruta - pl.gastosOperativos;
  return [
    { label: "Ingresos", value: pl.ingresosPl, kind: "positive" },
    { label: "COGS", value: -pl.costoVentas, kind: "negative" },
    { label: "Utilidad bruta", value: pl.utilidadBruta, kind: "total" },
    { label: "Gastos op.", value: -pl.gastosOperativos, kind: "negative" },
    { label: "EBIT", value: ebit, kind: "total" },
    { label: "Otros/Imp.", value: pl.netIncome - ebit, kind: pl.netIncome - ebit >= 0 ? "positive" : "negative" },
    { label: "Utilidad neta", value: pl.netIncome, kind: "total" },
  ];
}
