import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 — /empresas/at-risk segmentation. Replaces the legacy RFM redirect
 * stub with a real page that buckets canonical companies into 4 risk
 * categories sourced from gold_company_360:
 *
 *   - blacklist:  blacklist_level IN ('69b_presunto','69b_definitivo')
 *   - overdue:    overdue_amount_mxn > THRESHOLD (default 50k MXN)
 *   - dormant:    last_invoice_date < NOW() - 12m AND lifetime_value_mxn > 0
 *   - late_otd:   otd_rate < 0.7 AND otd_rate IS NOT NULL
 *
 * One company can appear in multiple buckets (e.g., blacklisted AND
 * overdue). Each bucket returns top-N rows ordered by impact ($ at risk
 * for AR buckets, LTV for blacklist/dormant). Quimibond self (id=868) is
 * excluded everywhere.
 */

const QUIMIBOND_SELF_ID = 868;
const OVERDUE_THRESHOLD_MXN = 50_000;
const OTD_THRESHOLD = 0.7;

export interface AtRiskCompanyRow {
  canonical_company_id: number;
  display_name: string;
  rfc: string | null;
  tier: string | null;
  blacklist_level: string | null;
  lifetime_value_mxn: number;
  overdue_amount_mxn: number;
  max_days_overdue: number | null;
  otd_rate: number | null;
  last_invoice_date: string | null;
}

export interface AtRiskBucket {
  rows: AtRiskCompanyRow[];
  totalCount: number;
  totalAmount: number;
}

export interface AtRiskOverview {
  blacklist: AtRiskBucket;
  overdue: AtRiskBucket;
  dormant: AtRiskBucket;
  lateOtd: AtRiskBucket;
}

const SELECT_COLS =
  "canonical_company_id, display_name, rfc, tier, blacklist_level, lifetime_value_mxn, overdue_amount_mxn, max_days_overdue, otd_rate, last_invoice_date";

function cutoff12mIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
}

function mapRow(r: Record<string, unknown>): AtRiskCompanyRow {
  return {
    canonical_company_id: Number(r.canonical_company_id) || 0,
    display_name: (r.display_name as string) ?? "—",
    rfc: (r.rfc as string) ?? null,
    tier: (r.tier as string) ?? null,
    blacklist_level: (r.blacklist_level as string) ?? null,
    lifetime_value_mxn: Number(r.lifetime_value_mxn) || 0,
    overdue_amount_mxn: Number(r.overdue_amount_mxn) || 0,
    max_days_overdue:
      r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    otd_rate: r.otd_rate != null ? Number(r.otd_rate) : null,
    last_invoice_date: (r.last_invoice_date as string) ?? null,
  };
}

async function _getAtRiskOverviewRaw(
  perBucket: number = 10,
): Promise<AtRiskOverview> {
  const sb = getServiceClient();
  const cutoff = cutoff12mIso();

  const [blRes, blCount, blSum, overdueRes, overdueCount, overdueSum, dormantRes, dormantCount, dormantSum, lateRes, lateCount] = await Promise.all([
    sb
      .from("gold_company_360")
      .select(SELECT_COLS)
      .in("blacklist_level", ["69b_presunto", "69b_definitivo"])
      .neq("canonical_company_id", QUIMIBOND_SELF_ID)
      .order("lifetime_value_mxn", { ascending: false, nullsFirst: false })
      .limit(perBucket),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .in("blacklist_level", ["69b_presunto", "69b_definitivo"])
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select("lifetime_value_mxn")
      .in("blacklist_level", ["69b_presunto", "69b_definitivo"])
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select(SELECT_COLS)
      .gt("overdue_amount_mxn", OVERDUE_THRESHOLD_MXN)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID)
      .order("overdue_amount_mxn", { ascending: false, nullsFirst: false })
      .limit(perBucket),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .gt("overdue_amount_mxn", OVERDUE_THRESHOLD_MXN)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select("overdue_amount_mxn")
      .gt("overdue_amount_mxn", OVERDUE_THRESHOLD_MXN)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select(SELECT_COLS)
      .or("is_customer.eq.true,is_supplier.eq.true")
      .or(`last_invoice_date.lt.${cutoff},last_invoice_date.is.null`)
      .gt("lifetime_value_mxn", 0)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID)
      .order("lifetime_value_mxn", { ascending: false, nullsFirst: false })
      .limit(perBucket),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .or("is_customer.eq.true,is_supplier.eq.true")
      .or(`last_invoice_date.lt.${cutoff},last_invoice_date.is.null`)
      .gt("lifetime_value_mxn", 0)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select("lifetime_value_mxn")
      .or("is_customer.eq.true,is_supplier.eq.true")
      .or(`last_invoice_date.lt.${cutoff},last_invoice_date.is.null`)
      .gt("lifetime_value_mxn", 0)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select(SELECT_COLS)
      .lt("otd_rate", OTD_THRESHOLD)
      .not("otd_rate", "is", null)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID)
      .order("otd_rate", { ascending: true, nullsFirst: false })
      .limit(perBucket),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .lt("otd_rate", OTD_THRESHOLD)
      .not("otd_rate", "is", null)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
  ]);

  const sumOf = (rows: Array<Record<string, unknown>>, key: string): number =>
    rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  const blRowsRaw = (blRes.data ?? []) as Array<Record<string, unknown>>;
  const overdueRowsRaw = (overdueRes.data ?? []) as Array<Record<string, unknown>>;
  const dormantRowsRaw = (dormantRes.data ?? []) as Array<Record<string, unknown>>;
  const lateRowsRaw = (lateRes.data ?? []) as Array<Record<string, unknown>>;

  return {
    blacklist: {
      rows: blRowsRaw.map(mapRow),
      totalCount: blCount.count ?? 0,
      totalAmount: sumOf(
        (blSum.data ?? []) as Array<Record<string, unknown>>,
        "lifetime_value_mxn",
      ),
    },
    overdue: {
      rows: overdueRowsRaw.map(mapRow),
      totalCount: overdueCount.count ?? 0,
      totalAmount: sumOf(
        (overdueSum.data ?? []) as Array<Record<string, unknown>>,
        "overdue_amount_mxn",
      ),
    },
    dormant: {
      rows: dormantRowsRaw.map(mapRow),
      totalCount: dormantCount.count ?? 0,
      totalAmount: sumOf(
        (dormantSum.data ?? []) as Array<Record<string, unknown>>,
        "lifetime_value_mxn",
      ),
    },
    lateOtd: {
      rows: lateRowsRaw.map(mapRow),
      totalCount: lateCount.count ?? 0,
      totalAmount: 0,
    },
  };
}

export const getAtRiskOverview = unstable_cache(
  _getAtRiskOverviewRaw,
  ["sp13-empresas-at-risk-overview"],
  { revalidate: 300, tags: ["companies"] },
);
