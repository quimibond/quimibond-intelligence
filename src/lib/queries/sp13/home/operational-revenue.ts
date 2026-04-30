import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Operational revenue trend — read from canonical_account_balances filtered
 * to operational sales accounts (401.* + 402.*).
 *
 * WHY this source:
 *  - `gold_pl_statement.total_income` mixes 4xx + 7xx (operational + sale-leaseback,
 *    FX gain, interest, other income). Inflates trend.
 *  - `gold_revenue_monthly` (canonical_invoices direction='issued') includes
 *    one-off events like sale-leaseback CFDIs — e.g. mar-2026 had a single
 *    $13.2M invoice to LEASING LEPEZO that distorted the month.
 *  - `canonical_account_balances` filtered to 401+402 = operational sales only.
 *    Same data your accountant calls "ventas" in the P&L.
 *
 * Account convention (Mexican chart of accounts, Quimibond):
 *  - 401.01.* = Ventas con IVA general
 *  - 401.25.* = Ventas exportación
 *  - 402.*    = Devoluciones / descuentos / rebajas (positive balance reduces revenue)
 *
 * Balances are stored credit-positive (negative balance = revenue earned).
 * We flip signs and round so callers see positive MXN.
 */

export interface OperationalRevenuePoint {
  /** ISO date string YYYY-MM-01 — start of the month. */
  period: string;
  /** Revenue in MXN (positive). */
  revenue: number;
}

async function _getOperationalRevenueTrendRaw(
  months = 12,
): Promise<OperationalRevenuePoint[]> {
  const sb = getServiceClient();
  // We pull months+12 worth of buffer from canonical_account_balances and
  // bucket client-side. Period is YYYY-MM text.
  const buffer = months + 12;
  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth() - buffer, 1);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}`;

  const { data, error } = await sb
    .from("canonical_account_balances")
    .select("period, account_code, balance")
    .or("account_code.like.401.%,account_code.like.402.%")
    .gte("period", sinceStr)
    .order("period", { ascending: false });

  if (error) {
    console.error("[getOperationalRevenueTrend]", error.message);
    return [];
  }

  type Row = { period: string | null; account_code: string | null; balance: number | null };
  const rows = (data ?? []) as Row[];

  // Aggregate by period (sum balances; flip sign so revenue is positive).
  const byPeriod = new Map<string, number>();
  for (const r of rows) {
    if (!r.period) continue;
    const bal = Number(r.balance) || 0;
    byPeriod.set(r.period, (byPeriod.get(r.period) ?? 0) + bal);
  }

  // Filter outliers: dec-2022 has -$146M from year-end correcting entries.
  // We exclude any period with abs(revenue) > $50M as an obvious outlier
  // (operational sales sit in the $9-18M/month range historically).
  const OUTLIER_THRESHOLD = 50_000_000;

  const sorted = Array.from(byPeriod.entries())
    .map(([period, sum]) => ({
      period: `${period}-01`,
      revenue: -sum, // flip credit-positive → revenue-positive
    }))
    .filter((p) => {
      const yr = Number(p.period.slice(0, 4));
      return (
        yr >= 2020 &&
        yr <= 2030 &&
        Math.abs(p.revenue) <= OUTLIER_THRESHOLD
      );
    })
    .sort((a, b) => (a.period < b.period ? 1 : -1)) // desc
    .slice(0, months)
    .reverse(); // back to ascending for chart

  return sorted.map((p) => ({
    period: p.period,
    revenue: Math.round(p.revenue),
  }));
}

export const getOperationalRevenueTrend = unstable_cache(
  _getOperationalRevenueTrendRaw,
  ["sp13-home-op-revenue-trend-v1"],
  { revalidate: 300, tags: ["dashboard", "home", "finanzas"] },
);

/**
 * Single-period operational revenue helper (current month, last month, YTD).
 * Used to replace `revenue.{this_month, last_month, ytd}` from the legacy
 * `get_dashboard_kpis()` RPC, which was pulling from gold_pl_statement.total_income
 * (mixed 4xx + 7xx, ~$32M YTD underreport).
 */
export interface OperationalRevenueSnapshot {
  thisMonth: number;
  lastMonth: number;
  ytd: number;
}

async function _getOperationalRevenueSnapshotRaw(): Promise<OperationalRevenueSnapshot> {
  const sb = getServiceClient();
  const now = new Date();
  const yyyy = now.getFullYear();
  const thisPeriod = `${yyyy}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastDate = new Date(yyyy, now.getMonth() - 1, 1);
  const lastPeriod = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, "0")}`;
  const ytdFrom = `${yyyy}-01`;

  const { data, error } = await sb
    .from("canonical_account_balances")
    .select("period, balance")
    .or("account_code.like.401.%,account_code.like.402.%")
    .gte("period", ytdFrom)
    .lte("period", thisPeriod);

  if (error) {
    console.error("[getOperationalRevenueSnapshot]", error.message);
    return { thisMonth: 0, lastMonth: 0, ytd: 0 };
  }

  let thisMonth = 0;
  let lastMonth = 0;
  let ytd = 0;
  for (const r of (data ?? []) as Array<{ period: string | null; balance: number | null }>) {
    if (!r.period) continue;
    const v = -(Number(r.balance) || 0); // flip credit-positive
    ytd += v;
    if (r.period === thisPeriod) thisMonth += v;
    if (r.period === lastPeriod) lastMonth += v;
  }

  return {
    thisMonth: Math.round(thisMonth),
    lastMonth: Math.round(lastMonth),
    ytd: Math.round(ytd),
  };
}

export const getOperationalRevenueSnapshot = unstable_cache(
  _getOperationalRevenueSnapshotRaw,
  ["sp13-home-op-revenue-snap-v1"],
  { revalidate: 300, tags: ["dashboard", "home", "finanzas"] },
);
