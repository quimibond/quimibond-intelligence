import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F2 — Runway estimate.
 *
 * burnRate = promedio mensual de |total_expense| de los 3 meses completos
 * anteriores al mes en curso, /30d. Excluye el mes actual porque está
 * parcialmente incompleto y distorsiona el promedio hacia abajo.
 *
 * `runwayCashOnly` = cash / burnRate.
 * `runwayWithAr`   = (cash + AR abierto) / burnRate.
 *
 * Sources (gold-only):
 * - `gold_cashflow.current_cash_mxn`      → saldo en efectivo
 * - `gold_cashflow.total_receivable_mxn`  → AR abierto autoritativo
 * - `gold_pl_statement.total_expense`     → burn rate (3 meses cerrados)
 */
export interface RunwayKpis {
  burnRateDaily: number;
  burnRateMonthly: number;
  runwayCashOnlyDays: number | null;
  runwayWithArDays: number | null;
  cashMxn: number;
  arOpenMxn: number;
  burnWindow: { from: string; to: string; monthsCovered: number };
}

async function _getRunwayKpisRaw(): Promise<RunwayKpis> {
  const sb = getServiceClient();
  const now = new Date();
  // Closed-month window: last 3 months BEFORE the current one.
  // Current month (partial) would skew the average down.
  const endYear = now.getFullYear();
  const endMonth = now.getMonth(); // 0-indexed — this is the first month to exclude
  const startDate = new Date(endYear, endMonth - 3, 1);
  const endDate = new Date(endYear, endMonth, 0); // last day of prior month
  const from = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  const to = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`;

  const [cashflow, plLast3] = await Promise.all([
    sb
      .from("gold_cashflow")
      .select("current_cash_mxn, total_receivable_mxn")
      .maybeSingle(),
    sb
      .from("gold_pl_statement")
      .select("period, total_expense")
      .gte("period", from)
      .lte("period", to)
      .order("period", { ascending: false }),
  ]);

  type Cashflow = {
    current_cash_mxn: number | null;
    total_receivable_mxn: number | null;
  };
  const cf = (cashflow.data ?? null) as Cashflow | null;
  const cash = Number(cf?.current_cash_mxn) || 0;
  const arOpen = Number(cf?.total_receivable_mxn) || 0;

  const plRows = (plLast3.data ?? []) as Array<{ total_expense: number | null }>;
  const totalExpense = plRows.reduce(
    (s, r) => s + Math.max(0, Number(r.total_expense) || 0),
    0
  );
  const monthsCovered = Math.max(plRows.length, 1);
  const burnRateMonthly = totalExpense / monthsCovered;
  const burnRateDaily = burnRateMonthly / 30;

  const runwayCashOnly = burnRateDaily > 0 ? cash / burnRateDaily : null;
  const runwayWithAr = burnRateDaily > 0 ? (cash + arOpen) / burnRateDaily : null;

  return {
    burnRateDaily: Math.round(burnRateDaily * 100) / 100,
    burnRateMonthly: Math.round(burnRateMonthly * 100) / 100,
    runwayCashOnlyDays: runwayCashOnly == null ? null : Math.round(runwayCashOnly),
    runwayWithArDays: runwayWithAr == null ? null : Math.round(runwayWithAr),
    cashMxn: cash,
    arOpenMxn: arOpen,
    burnWindow: { from, to, monthsCovered },
  };
}

export const getRunwayKpis = unstable_cache(
  _getRunwayKpisRaw,
  ["sp13-finanzas-runway-gold"],
  { revalidate: 60, tags: ["finanzas"] }
);
