import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * pnl.ts — P&L queries.
 *
 * Gold layer: gold_pl_statement (period, total_income, total_expense, net_income, by_level_1)
 * Bronze layer: odoo_account_balances — account-level trial balance for PnlPorCuentaSection
 *   SP5-VERIFIED: odoo_account_balances is Bronze authoritative for account-level P&L detail —
 *   no canonical equivalent in SP4 scope; gold_pl_statement is period-aggregate only.
 *
 * NOTE: gold_pl_statement.total_income is stored as a negative number (accounting sign).
 * For display, use revenue_display = Math.abs(total_income).
 */

// ──────────────────────────────────────────────────────────────────────────
// Gold layer — period-level P&L (gold_pl_statement)
// ──────────────────────────────────────────────────────────────────────────

export interface PlStatementRow {
  period: string;
  total_income: number;
  total_expense: number;
  net_income: number;
  /** Raw JSONB breakdown by account level-1 group */
  by_level_1: Record<string, unknown> | null;
  refreshed_at: string | null;
  /** Display-friendly revenue (positive). DB value is total_income (negative sign). */
  revenue_display: number;
}

export async function fetchPL(
  opts: { from?: string; to?: string; limit?: number } = {}
): Promise<PlStatementRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("gold_pl_statement")
    .select("*")
    .order("period", { ascending: false });
  if (opts.from) q = q.gte("period", opts.from);
  if (opts.to) q = q.lte("period", opts.to);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Array<{
    period: string;
    total_income: number | null;
    total_expense: number | null;
    net_income: number | null;
    by_level_1: Record<string, unknown> | null;
    refreshed_at: string | null;
  }>).map((r) => ({
    period: r.period,
    total_income: Number(r.total_income ?? 0),
    total_expense: Number(r.total_expense ?? 0),
    net_income: Number(r.net_income ?? 0),
    by_level_1: r.by_level_1 ?? null,
    refreshed_at: r.refreshed_at ?? null,
    // total_income is negative in DB (income is credit side); expose positive for display
    revenue_display: Math.abs(Number(r.total_income ?? 0)),
  }));
}

// Convenience re-exports
export const fetchIncomeStatement = fetchPL;
export const getPl = fetchPL;

// ──────────────────────────────────────────────────────────────────────────
// Bronze layer — account-level trial balance
// SP5-VERIFIED: odoo_account_balances is Bronze authoritative for account-level
// P&L detail — no canonical equivalent in SP4 scope.
// ──────────────────────────────────────────────────────────────────────────

export interface PnlByAccountRow {
  account_code: string | null;
  account_name: string | null;
  account_type: string | null;
  period: string;
  debit: number;
  credit: number;
  net: number;
}

export async function getMostRecentPeriod(): Promise<string | null> {
  const sb = getServiceClient();
  // SP5-VERIFIED: odoo_account_balances is Bronze authoritative for account-level P&L detail
  const { data, error } = await sb
    .from("odoo_account_balances") // SP5-EXCEPTION: odoo_account_balances is Bronze-authoritative for account-level P&L detail; no canonical equivalent exists in SP4 scope. TODO SP6.
    .select("period")
    .order("period", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].period as string;
}

/**
 * getPnlByAccount — account-level trial balance for a given period.
 * Reads odoo_account_balances (Bronze) which has account_code/name/type denormalized.
 * SP5-VERIFIED: Bronze read — no canonical equivalent for account-level detail in SP4 scope.
 */
export async function getPnlByAccount(
  period?: string,
  limit = 300
): Promise<PnlByAccountRow[]> {
  const sb = getServiceClient();

  const targetPeriod = period ?? (await getMostRecentPeriod());
  if (!targetPeriod) return [];

  // SP5-VERIFIED: odoo_account_balances Bronze authoritative for account-level P&L detail
  const { data, error } = await sb
    .from("odoo_account_balances") // SP5-EXCEPTION: odoo_account_balances is Bronze-authoritative for account-level P&L detail; no canonical equivalent exists in SP4 scope. TODO SP6.
    .select("account_code, account_name, account_type, period, debit, credit, balance")
    .eq("period", targetPeriod)
    .order("account_code", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`pnl by account query failed: ${error.message}`);

  return (data ?? []).map((b): PnlByAccountRow => {
    const debit = Number(b.debit ?? 0);
    const credit = Number(b.credit ?? 0);
    return {
      account_code: b.account_code ?? null,
      account_name: b.account_name ?? null,
      account_type: b.account_type ?? null,
      period: b.period as string,
      debit,
      credit,
      net: debit - credit,
    };
  });
}
