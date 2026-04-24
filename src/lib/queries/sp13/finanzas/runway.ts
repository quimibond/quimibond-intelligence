import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F2 — Runway estimate.
 *
 * burnRate = average monthly gasto total (|total_expense|) últimos 3 meses,
 * normalizado a /día. `runwayCashOnly` = cash / burnRate.
 * `runwayWithAr` añade AR abierto (asume cobranza normal) al numerador.
 *
 * AR SOURCE: canonical_invoices.amount_residual_mxn_odoo (single-FX, validated).
 * Do NOT use gold_cashflow.total_receivable_mxn or amount_residual_mxn_resolved
 * — both have a double-FX bug for USD invoices that inflates the total ~10x.
 * See working-capital.ts header note for the data-quality issue.
 *
 * CASH SOURCE: canonical_bank_balances (classification='cash') — direct,
 * no derived aggregate needed.
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

  const [banks, plLast3, openAr] = await Promise.all([
    sb
      .from("canonical_bank_balances")
      .select("classification, current_balance_mxn"),
    sb
      .from("gold_pl_statement")
      .select("period, total_expense")
      .gte("period", cutoffMonth)
      .order("period", { ascending: false })
      .limit(3),
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_odoo")
      .eq("direction", "issued")
      .gt("amount_residual_mxn_odoo", 0),
  ]);

  type Bank = { classification: string | null; current_balance_mxn: number | null };
  const cash = ((banks.data ?? []) as Bank[])
    .filter((b) => b.classification === "cash")
    .reduce((s, b) => s + (Number(b.current_balance_mxn) || 0), 0);

  const arRows = (openAr.data ?? []) as Array<{
    amount_residual_mxn_odoo: number | null;
  }>;
  const arOpen = arRows.reduce(
    (s, r) => s + (Number(r.amount_residual_mxn_odoo) || 0),
    0
  );

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
  ["sp13-finanzas-runway-v2-fx-fix"],
  { revalidate: 60, tags: ["finanzas"] }
);
