import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F2 — Runway estimate.
 *
 * burnRate = promedio mensual de gasto total (|total_expense|) últimos 90 días,
 * normalizado a /día. `runwayCashOnly` = cash / burnRate.
 * `runwayWithAr` añade AR abierto (asume cobranza normal) al numerador.
 */
export interface RunwayKpis {
  burnRateDaily: number;
  burnRateMonthly: number;
  runwayCashOnlyDays: number | null;
  runwayWithArDays: number | null;
  cashMxn: number;
  arOpenMxn: number;
}

async function _getRunwayKpisRaw(): Promise<RunwayKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const cutoffMonth = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    .toISOString()
    .slice(0, 7);

  const [cashflow, plLast3, openAr] = await Promise.all([
    sb.from("gold_cashflow").select("current_cash_mxn, total_receivable_mxn").maybeSingle(),
    sb
      .from("gold_pl_statement")
      .select("period, total_expense")
      .gte("period", cutoffMonth)
      .order("period", { ascending: false })
      .limit(3),
    // Fallback AR aggregation in case gold_cashflow.total_receivable_mxn is stale
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_resolved, amount_residual_mxn_odoo")
      .eq("direction", "issued")
      .neq("estado_sat", "cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"),
  ]);

  const cash =
    Number((cashflow.data as { current_cash_mxn: number | null } | null)?.current_cash_mxn) ||
    0;

  const goldAr = Number(
    (cashflow.data as { total_receivable_mxn: number | null } | null)?.total_receivable_mxn
  );
  const arRows = (openAr.data ?? []) as Array<{
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
  }>;
  const computedAr = arRows.reduce(
    (s, r) =>
      s + (Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0),
    0
  );
  const arOpen = goldAr && goldAr > 0 ? goldAr : computedAr;

  const plRows = (plLast3.data ?? []) as Array<{
    total_expense: number | null;
  }>;
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
  };
}

export const getRunwayKpis = unstable_cache(
  _getRunwayKpisRaw,
  ["sp13-finanzas-runway"],
  { revalidate: 60, tags: ["finanzas"] }
);
