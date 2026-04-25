import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F3.5 — Balance general mensual.
 *
 * Source: `gold_balance_sheet` (materialized view) para totales y staleness;
 * `get_cash_reconciliation` RPC para el desglose por categoría (AR, Inv,
 * Fixed, AP, Debt, etc.) usando saldos acumulados al cierre.
 */
export interface BalanceSheetBucket {
  bucket: "asset" | "liability" | "equity" | "income" | "expense";
  totalMxn: number;
  accountsCount: number;
}

export interface BalanceSheetCategoryRow {
  category: string;
  categoryLabel: string;
  side: "asset" | "liability" | "equity";
  closingMxn: number;
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
  detailRows: BalanceSheetCategoryRow[];
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

  // Detail breakdown desde get_cash_reconciliation (mismo período, no usamos
  // deltas — solo closing_mxn por categoría).
  const detailRows: BalanceSheetCategoryRow[] = [];
  try {
    // Para que la función calcule closing al período actual, le damos
    // p_to_period = el período del snapshot. p_from_period = un mes antes
    // (no afecta el closing, solo el delta que ignoramos).
    const fromPeriod = priorMonthOf(row.period);
    const { data: detail, error: detErr } = await sb.rpc(
      "get_cash_reconciliation",
      { p_from_period: fromPeriod, p_to_period: row.period }
    );
    if (detErr) {
      console.error("[getBalanceSheet] detail rpc failure", detErr.message);
    } else if (detail) {
      type DetRow = {
        category: string;
        category_label: string;
        prefix_pattern: string;
        closing_mxn: number | string;
      };
      for (const r of detail as DetRow[]) {
        const side: "asset" | "liability" | "equity" = r.prefix_pattern.startsWith(
          "asset_"
        )
          ? "asset"
          : r.prefix_pattern.startsWith("liability_")
            ? "liability"
            : "equity";
        detailRows.push({
          category: r.category,
          categoryLabel: r.category_label,
          side,
          closingMxn: Number(r.closing_mxn) || 0,
        });
      }
    }
  } catch (e) {
    console.error("[getBalanceSheet] detail exception", e);
  }

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
    detailRows,
    asOfDate: row.refreshed_at,
  };
}

function priorMonthOf(periodYYYYMM: string): string {
  const [y, m] = periodYYYYMM.split("-").map((s) => parseInt(s, 10));
  const prior = new Date(y, m - 2, 1);
  const py = prior.getFullYear();
  const pm = String(prior.getMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
}

export const getBalanceSheet = unstable_cache(
  _getBalanceSheetRaw,
  ["sp13-finanzas-balance-sheet"],
  { revalidate: 300, tags: ["finanzas"] }
);
