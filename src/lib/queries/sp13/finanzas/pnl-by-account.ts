import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-PnL — P&L drilldown by account.
 *
 * Source: `canonical_account_balances` filtered to expense + income buckets
 * for the selected period. Aggregated per account_code with display name
 * and account_type. Returns top-N accounts by abs(balance).
 *
 * Buckets we care about for P&L:
 * - income (revenue accounts, balance is negative by convention; abs for display)
 * - expense (cost of goods + operating expenses)
 *
 * Sign convention: income balances are stored negative (credit), expenses
 * positive (debit). UI shows abs(balance) so both look like positive amounts.
 */
export interface PnlAccountRow {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  bucket: "expense" | "income";
  balanceMxn: number;
}

export interface PnlByAccountSummary {
  period: HistoryRange;
  periodLabel: string;
  monthsCovered: number;
  totalIncomeMxn: number;
  totalExpenseMxn: number;
  rows: PnlAccountRow[];
}

async function _getPnlByAccountRaw(
  range: HistoryRange,
  limit = 20
): Promise<PnlByAccountSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const { data, error } = await sb
    .from("canonical_account_balances")
    .select("account_code, account_name, account_type, balance, balance_sheet_bucket, period")
    .gte("period", bounds.fromMonth)
    .lte("period", bounds.toMonth.slice(0, 7))
    .in("balance_sheet_bucket", ["expense", "income"])
    .eq("deprecated", false);

  if (error) {
    console.error("[getPnlByAccount] query failure", error.message);
    return {
      period: range,
      periodLabel: bounds.label,
      monthsCovered: 0,
      totalIncomeMxn: 0,
      totalExpenseMxn: 0,
      rows: [],
    };
  }

  type Row = {
    account_code: string;
    account_name: string;
    account_type: string | null;
    balance: number | null;
    balance_sheet_bucket: string;
    period: string;
  };
  const raw = (data ?? []) as Row[];
  const months = new Set(raw.map((r) => r.period));

  // Aggregate by account_code (sum balances across periods)
  const agg = new Map<string, PnlAccountRow>();
  for (const r of raw) {
    const code = r.account_code;
    const bucket = r.balance_sheet_bucket as "income" | "expense";
    const existing =
      agg.get(code) ??
      ({
        accountCode: code,
        accountName: r.account_name ?? "",
        accountType: r.account_type,
        bucket,
        balanceMxn: 0,
      } as PnlAccountRow);
    existing.balanceMxn += Number(r.balance) || 0;
    agg.set(code, existing);
  }

  // Convert: income balances are stored negative → flip for display
  const rows = [...agg.values()]
    .map((r) => ({
      ...r,
      balanceMxn: r.bucket === "income" ? Math.abs(r.balanceMxn) : r.balanceMxn,
    }))
    .filter((r) => Math.abs(r.balanceMxn) > 0)
    .sort((a, b) => Math.abs(b.balanceMxn) - Math.abs(a.balanceMxn))
    .slice(0, limit);

  const totalIncomeMxn = rows
    .filter((r) => r.bucket === "income")
    .reduce((s, r) => s + r.balanceMxn, 0);
  const totalExpenseMxn = rows
    .filter((r) => r.bucket === "expense")
    .reduce((s, r) => s + r.balanceMxn, 0);

  return {
    period: range,
    periodLabel: bounds.label,
    monthsCovered: months.size,
    totalIncomeMxn,
    totalExpenseMxn,
    rows,
  };
}

export async function getPnlByAccount(
  range: HistoryRange,
  limit = 20
): Promise<PnlByAccountSummary> {
  return _getPnlByAccountRaw(range, limit);
}
