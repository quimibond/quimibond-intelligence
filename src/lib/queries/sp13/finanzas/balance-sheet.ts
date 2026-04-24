import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F3.5 — Balance general mensual.
 *
 * Source: `gold_balance_sheet` (materialized view). Pre-computed bucket
 * breakdown per period: assets / liabilities / equity + counts.
 *
 * Latest row = most recent period. `asOfDate` is the view's `refreshed_at`
 * so the UI can badge staleness when the refresh has lagged.
 */
export interface BalanceSheetBucket {
  bucket: "asset" | "liability" | "equity" | "income" | "expense";
  totalMxn: number;
  accountsCount: number;
}

export interface BalanceSheetSnapshot {
  period: string;
  totalAssetsMxn: number;
  totalLiabilitiesMxn: number;
  totalEquityMxn: number;
  netIncomeLifetimeMxn: number;
  unbalancedAmountMxn: number;
  liquidityRatio: number | null;
  debtToEquityRatio: number | null;
  buckets: BalanceSheetBucket[];
  asOfDate: string | null;
}

type RawBucket = { total: number; accounts_count: number };

async function _getBalanceSheetRaw(): Promise<BalanceSheetSnapshot | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("gold_balance_sheet")
    .select(
      "period, total_assets, total_liabilities, total_equity, net_income_lifetime, unbalanced_amount, by_bucket, refreshed_at"
    )
    .order("period", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getBalanceSheet] query failure", error.message);
    return null;
  }
  if (!data) return null;

  type Row = {
    period: string;
    total_assets: number | null;
    total_liabilities: number | null;
    total_equity: number | null;
    net_income_lifetime: number | null;
    unbalanced_amount: number | null;
    by_bucket: Record<string, RawBucket> | null;
    refreshed_at: string | null;
  };
  const row = data as Row;

  const totalAssets = Number(row.total_assets) || 0;
  const totalLiabilities = Math.abs(Number(row.total_liabilities) || 0);
  const totalEquity = Math.abs(Number(row.total_equity) || 0);

  const buckets: BalanceSheetBucket[] = [];
  if (row.by_bucket) {
    for (const [key, raw] of Object.entries(row.by_bucket)) {
      buckets.push({
        bucket: key as BalanceSheetBucket["bucket"],
        totalMxn: Math.abs(Number(raw.total) || 0),
        accountsCount: Number(raw.accounts_count) || 0,
      });
    }
  }

  // Liquidity & leverage are approximations off the aggregated buckets:
  // - liquidityRatio = assets / liabilities (> 1 = healthy)
  // - debtToEquityRatio = liabilities / equity (< 1 = conservative)
  const liquidityRatio =
    totalLiabilities > 0 ? totalAssets / totalLiabilities : null;
  const debtToEquityRatio =
    totalEquity > 0 ? totalLiabilities / totalEquity : null;

  return {
    period: row.period,
    totalAssetsMxn: totalAssets,
    totalLiabilitiesMxn: totalLiabilities,
    totalEquityMxn: totalEquity,
    netIncomeLifetimeMxn: Number(row.net_income_lifetime) || 0,
    unbalancedAmountMxn: Number(row.unbalanced_amount) || 0,
    liquidityRatio:
      liquidityRatio == null ? null : Math.round(liquidityRatio * 100) / 100,
    debtToEquityRatio:
      debtToEquityRatio == null ? null : Math.round(debtToEquityRatio * 100) / 100,
    buckets,
    asOfDate: row.refreshed_at,
  };
}

export const getBalanceSheet = unstable_cache(
  _getBalanceSheetRaw,
  ["sp13-finanzas-balance-sheet"],
  { revalidate: 300, tags: ["finanzas"] }
);
