import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Odoo↔SAT drift aggregates + per-invoice drilldown for a canonical_companies row.
 *
 * Backing objects (docs/superpowers/plans/2026-04-24-odoo-sat-drift-hardening.md):
 * - canonical_companies.drift_* columns (AR 2022+, AP 2025+). Refreshed hourly by
 *   `refresh_canonical_company_financials_hourly` at HH:45 UTC.
 * - canonical_companies.is_foreign/is_bank/is_government/is_payroll_entity flags —
 *   when any is true, drift_needs_review is suppressed (noise bucket).
 * - gold_company_odoo_sat_drift view — invoice-level drilldown.
 *
 * NOTE: drift_* and is_* fields are not in database.types.ts yet (regen pending
 * supabase login). Selects are cast to explicit types to stay type-safe.
 */

export interface CompanyDriftAggregates {
  canonical_company_id: number;
  // AR (issued / customer side, 2022+)
  drift_sat_only_count: number;
  drift_sat_only_mxn: number;
  drift_odoo_only_count: number;
  drift_odoo_only_mxn: number;
  drift_matched_diff_count: number;
  drift_matched_abs_mxn: number;
  drift_total_abs_mxn: number;
  drift_needs_review: boolean;
  drift_last_computed_at: string | null;
  // AP (received / supplier side, 2025+)
  drift_ap_sat_only_count: number;
  drift_ap_sat_only_mxn: number;
  drift_ap_odoo_only_count: number;
  drift_ap_odoo_only_mxn: number;
  drift_ap_matched_diff_count: number;
  drift_ap_matched_abs_mxn: number;
  drift_ap_total_abs_mxn: number;
  drift_ap_needs_review: boolean;
  // Category flags (used to render "drift suppressed" badges)
  is_foreign: boolean;
  is_bank: boolean;
  is_government: boolean;
  is_payroll_entity: boolean;
  // Display helpers
  display_name: string;
  rfc: string | null;
}

export type DriftSide = "customer" | "supplier";
export type DriftKind = "odoo_only" | "sat_only" | "amount_mismatch";

export interface CompanyDriftRow {
  side: DriftSide;
  canonical_company_id: number;
  display_name: string | null;
  canonical_id: number;
  drift_kind: DriftKind;
  invoice_date: string | null;
  sat_uuid: string | null;
  odoo_invoice_id: number | null;
  odoo_name: string | null;
  sat_mxn: number | null;
  odoo_mxn: number | null;
  diff_mxn: number | null;
}

// Row shape returned from the canonical_companies select — fields not yet in
// database.types.ts are surfaced via explicit cast.
interface RawAggRow {
  id: number;
  display_name: string;
  rfc: string | null;
  drift_sat_only_count: number | null;
  drift_sat_only_mxn: number | null;
  drift_odoo_only_count: number | null;
  drift_odoo_only_mxn: number | null;
  drift_matched_diff_count: number | null;
  drift_matched_abs_mxn: number | null;
  drift_total_abs_mxn: number | null;
  drift_needs_review: boolean | null;
  drift_last_computed_at: string | null;
  drift_ap_sat_only_count: number | null;
  drift_ap_sat_only_mxn: number | null;
  drift_ap_odoo_only_count: number | null;
  drift_ap_odoo_only_mxn: number | null;
  drift_ap_matched_diff_count: number | null;
  drift_ap_matched_abs_mxn: number | null;
  drift_ap_total_abs_mxn: number | null;
  drift_ap_needs_review: boolean | null;
  is_foreign: boolean | null;
  is_bank: boolean | null;
  is_government: boolean | null;
  is_payroll_entity: boolean | null;
}

const DRIFT_AGG_COLUMNS = [
  "id",
  "display_name",
  "rfc",
  "drift_sat_only_count",
  "drift_sat_only_mxn",
  "drift_odoo_only_count",
  "drift_odoo_only_mxn",
  "drift_matched_diff_count",
  "drift_matched_abs_mxn",
  "drift_total_abs_mxn",
  "drift_needs_review",
  "drift_last_computed_at",
  "drift_ap_sat_only_count",
  "drift_ap_sat_only_mxn",
  "drift_ap_odoo_only_count",
  "drift_ap_odoo_only_mxn",
  "drift_ap_matched_diff_count",
  "drift_ap_matched_abs_mxn",
  "drift_ap_total_abs_mxn",
  "drift_ap_needs_review",
  "is_foreign",
  "is_bank",
  "is_government",
  "is_payroll_entity",
].join(", ");

function toAggregates(row: RawAggRow): CompanyDriftAggregates {
  return {
    canonical_company_id: row.id,
    display_name: row.display_name,
    rfc: row.rfc,
    drift_sat_only_count: Number(row.drift_sat_only_count) || 0,
    drift_sat_only_mxn: Number(row.drift_sat_only_mxn) || 0,
    drift_odoo_only_count: Number(row.drift_odoo_only_count) || 0,
    drift_odoo_only_mxn: Number(row.drift_odoo_only_mxn) || 0,
    drift_matched_diff_count: Number(row.drift_matched_diff_count) || 0,
    drift_matched_abs_mxn: Number(row.drift_matched_abs_mxn) || 0,
    drift_total_abs_mxn: Number(row.drift_total_abs_mxn) || 0,
    drift_needs_review: Boolean(row.drift_needs_review),
    drift_last_computed_at: row.drift_last_computed_at,
    drift_ap_sat_only_count: Number(row.drift_ap_sat_only_count) || 0,
    drift_ap_sat_only_mxn: Number(row.drift_ap_sat_only_mxn) || 0,
    drift_ap_odoo_only_count: Number(row.drift_ap_odoo_only_count) || 0,
    drift_ap_odoo_only_mxn: Number(row.drift_ap_odoo_only_mxn) || 0,
    drift_ap_matched_diff_count: Number(row.drift_ap_matched_diff_count) || 0,
    drift_ap_matched_abs_mxn: Number(row.drift_ap_matched_abs_mxn) || 0,
    drift_ap_total_abs_mxn: Number(row.drift_ap_total_abs_mxn) || 0,
    drift_ap_needs_review: Boolean(row.drift_ap_needs_review),
    is_foreign: Boolean(row.is_foreign),
    is_bank: Boolean(row.is_bank),
    is_government: Boolean(row.is_government),
    is_payroll_entity: Boolean(row.is_payroll_entity),
  };
}

/**
 * Aggregate drift metrics for a single canonical_companies row.
 * Returns null when the company doesn't exist. Never throws on missing
 * drift fields — the cast covers pre-regen database.types.ts.
 */
async function _getCompanyDriftUncached(
  canonicalCompanyId: number,
): Promise<CompanyDriftAggregates | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_companies")
    // Cast via `as unknown` because drift_* + is_foreign/bank/gov/payroll are
    // not in generated Database types yet.
    .select(DRIFT_AGG_COLUMNS as unknown as "*")
    .eq("id", canonicalCompanyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toAggregates(data as unknown as RawAggRow);
}

export const getCompanyDrift = unstable_cache(
  _getCompanyDriftUncached,
  ["company-drift-aggregates"],
  { revalidate: 300, tags: ["finance", "companies"] },
);

interface RawDriftRow {
  side: DriftSide;
  canonical_company_id: number;
  display_name: string | null;
  canonical_id: number;
  drift_kind: DriftKind;
  invoice_date: string | null;
  sat_uuid: string | null;
  odoo_invoice_id: number | null;
  odoo_name: string | null;
  sat_mxn: number | string | null;
  odoo_mxn: number | string | null;
  diff_mxn: number | string | null;
}

async function _getCompanyDriftRowsUncached(
  canonicalCompanyId: number,
  opts: { side?: DriftSide; limit?: number } = {},
): Promise<CompanyDriftRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("gold_company_odoo_sat_drift")
    .select(
      "side, canonical_company_id, display_name, canonical_id, drift_kind, invoice_date, sat_uuid, odoo_invoice_id, odoo_name, sat_mxn, odoo_mxn, diff_mxn",
    )
    .eq("canonical_company_id", canonicalCompanyId)
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (opts.side) q = q.eq("side", opts.side);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as RawDriftRow[];
  return rows.map((r) => ({
    side: r.side,
    canonical_company_id: r.canonical_company_id,
    display_name: r.display_name,
    canonical_id: r.canonical_id,
    drift_kind: r.drift_kind,
    invoice_date: r.invoice_date,
    sat_uuid: r.sat_uuid,
    odoo_invoice_id: r.odoo_invoice_id,
    odoo_name: r.odoo_name,
    sat_mxn: r.sat_mxn != null ? Number(r.sat_mxn) : null,
    odoo_mxn: r.odoo_mxn != null ? Number(r.odoo_mxn) : null,
    diff_mxn: r.diff_mxn != null ? Number(r.diff_mxn) : null,
  }));
}

export const getCompanyDriftRows = unstable_cache(
  _getCompanyDriftRowsUncached,
  ["company-drift-rows"],
  { revalidate: 300, tags: ["finance", "companies"] },
);

/**
 * Derive a traffic-light tone for the AR or AP drift KPI.
 *
 * success: no drift
 * warning: drift < $10k and not flagged
 * danger:  drift >= $10k OR needs_review true (category-suppressed rows
 *          never pin needs_review, so this only fires on real drift)
 */
export function driftTone(
  totalAbsMxn: number | null | undefined,
  needsReview: boolean | null | undefined,
): "success" | "warning" | "danger" {
  const total = Number(totalAbsMxn) || 0;
  if (needsReview) return "danger";
  if (total <= 0) return "success";
  if (total < 10_000) return "warning";
  return "danger";
}

/**
 * True when at least one side shows drift worth surfacing — used by page.tsx
 * to conditionally register the "Auditoría SAT" tab.
 */
export function shouldShowDriftTab(agg: CompanyDriftAggregates | null): boolean {
  if (!agg) return false;
  return (agg.drift_total_abs_mxn ?? 0) > 0 || (agg.drift_ap_total_abs_mxn ?? 0) > 0;
}

export interface CompanyDriftSummary {
  total_abs_mxn: number;
  needs_review: boolean;
}

/**
 * Batch drift summary lookup for the /empresas list — fetches drift_total +
 * needs_review for many companies in a single round-trip, keyed by id.
 * Consumers iterate over list rows and decorate each with the summary.
 */
async function _getDriftSummaryMapUncached(
  canonicalCompanyIds: number[],
): Promise<Record<number, CompanyDriftSummary>> {
  if (canonicalCompanyIds.length === 0) return {};
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_companies")
    .select(
      "id, drift_total_abs_mxn, drift_needs_review, drift_ap_total_abs_mxn, drift_ap_needs_review" as unknown as "*",
    )
    .in("id", canonicalCompanyIds);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    id: number;
    drift_total_abs_mxn: number | null;
    drift_needs_review: boolean | null;
    drift_ap_total_abs_mxn: number | null;
    drift_ap_needs_review: boolean | null;
  }>;
  const out: Record<number, CompanyDriftSummary> = {};
  for (const r of rows) {
    out[r.id] = {
      total_abs_mxn:
        (Number(r.drift_total_abs_mxn) || 0) +
        (Number(r.drift_ap_total_abs_mxn) || 0),
      needs_review:
        Boolean(r.drift_needs_review) || Boolean(r.drift_ap_needs_review),
    };
  }
  return out;
}

export const getDriftSummaryMap = unstable_cache(
  _getDriftSummaryMapUncached,
  ["company-drift-summary-map"],
  { revalidate: 300, tags: ["finance", "companies"] },
);
