/**
 * src/lib/queries/unified/index.ts
 * SP5 Task 11: preserved as compat surface. New code should import from
 * analytics/ operational/ _shared/ directly.
 *
 * All legacy MV reads removed: invoices_unified → canonical_invoices.
 */
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

// Re-export everything from the two canonical modules
export * from "./invoices";
export * from "./invoice-detail";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
export type Severity = "critical" | "high" | "medium" | "low";
export type MatchStatus =
  | "match_uuid"
  | "match_composite"
  | "ambiguous"
  | "syntage_only"
  | "odoo_only";

/**
 * UnifiedInvoice — back-compat type surface for consumers using
 * getUnifiedInvoicesForCompany / getUnifiedRevenueAggregates.
 * Adapted from canonical_invoices column names.
 */
export interface UnifiedInvoice {
  canonical_id: string;
  // Back-compat aliases
  uuid_sat: string | null; // sat_uuid alias
  odoo_invoice_id: number | null;
  match_status: MatchStatus; // match_confidence cast to MatchStatus
  match_quality: string | null; // match_confidence
  direction: "issued" | "received";
  estado_sat: string | null;
  fecha_timbrado: string | null;
  fecha_cancelacion: string | null;
  total_fiscal: number | null; // amount_total_sat
  odoo_amount_total: number | null; // amount_total_odoo
  amount_residual: number | null; // amount_residual_mxn_odoo
  payment_state: string | null; // payment_state_odoo
  odoo_state: string | null; // state_odoo
  invoice_date: string | null;
  due_date: string | null; // due_date_odoo
  days_overdue: number | null; // computed
  odoo_amount_total_mxn: number | null; // amount_total_mxn_odoo
  odoo_amount_residual_mxn: number | null; // amount_residual_mxn_odoo
  salesperson_name: string | null; // not on canonical; null
  salesperson_user_id: number | null;
  odoo_currency: string | null; // currency_odoo
  moneda_fiscal: string | null; // currency_sat
  partner_name: string | null; // receptor_nombre or emisor_nombre
  company_id: number | null; // receptor_canonical_company_id
  odoo_company_id: number | null; // odoo_partner_id (proxy; SP6: canonical join)
  emisor_rfc: string | null;
  receptor_rfc: string | null;
  emisor_blacklist_status: string | null;
  receptor_blacklist_status: string | null;
  fiscal_operational_consistency: string | null; // state_mismatch cast
  amount_diff: number | null; // amount_total_mxn_diff_abs
  odoo_ref: string | null;
  email_id_origen: number | null; // always null — no column on canonical_invoices
}

export interface UnifiedAgingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  amount: number;
  count: number;
}

export interface UnifiedRevenueAggregate {
  revenue: number;
  count: number;
  uuidValidated: number;
  pctValidated: number;
}

export interface UnifiedReconciliationCounts {
  open: number;
  bySeverity: Record<Severity, number>;
}

export interface UnifiedRefreshStaleness {
  invoicesRefreshedAt: string | null;
  paymentsRefreshedAt: string | null;
  minutesSinceRefresh: number;
}

// ──────────────────────────────────────────────────────────────────────────
// isComputableRevenue — logic helper (no DB read; unchanged)
// ──────────────────────────────────────────────────────────────────────────
export function isComputableRevenue(row: {
  direction?: string | null;
  match_status?: string | null;
  estado_sat?: string | null;
  odoo_state?: string | null;
}): boolean {
  if (row.direction !== "issued") return false;
  if (
    !row.match_status ||
    !["match_uuid", "match_composite", "odoo_only"].includes(row.match_status)
  )
    return false;
  if ((row.estado_sat ?? "vigente") === "cancelado") return false;
  if (row.odoo_state != null && row.odoo_state !== "posted") return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers: map canonical_invoices row → UnifiedInvoice back-compat shape
// ──────────────────────────────────────────────────────────────────────────
function computeDaysOverdueIdx(due_date_odoo: string | null): number | null {
  if (!due_date_odoo) return null;
  const d = Math.floor(
    (Date.now() - new Date(due_date_odoo).getTime()) / 86400000
  );
  return d > 0 ? d : 0;
}

function mapCanonicalToUnified(r: Record<string, unknown>): UnifiedInvoice {
  const matchConf = (r.match_confidence as string | null) ?? "odoo_only";
  return {
    canonical_id: r.canonical_id as string,
    uuid_sat: (r.sat_uuid as string | null) ?? null,
    odoo_invoice_id:
      r.odoo_invoice_id != null ? Number(r.odoo_invoice_id) : null,
    match_status: matchConf as MatchStatus,
    match_quality: matchConf,
    direction: (r.direction as "issued" | "received") ?? "issued",
    estado_sat: (r.estado_sat as string | null) ?? null,
    fecha_timbrado: (r.fecha_timbrado as string | null) ?? null,
    fecha_cancelacion: (r.fecha_cancelacion as string | null) ?? null,
    total_fiscal:
      r.amount_total_sat != null ? Number(r.amount_total_sat) : null,
    odoo_amount_total:
      r.amount_total_odoo != null ? Number(r.amount_total_odoo) : null,
    amount_residual:
      r.amount_residual_mxn_odoo != null
        ? Number(r.amount_residual_mxn_odoo)
        : null,
    payment_state: (r.payment_state_odoo as string | null) ?? null,
    odoo_state: (r.state_odoo as string | null) ?? null,
    invoice_date: (r.invoice_date as string | null) ?? null,
    due_date: (r.due_date_odoo as string | null) ?? null,
    days_overdue: computeDaysOverdueIdx(
      (r.due_date_odoo as string | null) ?? null
    ),
    odoo_amount_total_mxn:
      r.amount_total_mxn_odoo != null ? Number(r.amount_total_mxn_odoo) : null,
    odoo_amount_residual_mxn:
      r.amount_residual_mxn_odoo != null
        ? Number(r.amount_residual_mxn_odoo)
        : null,
    salesperson_name: null, // SP6: join canonical_contacts via salesperson_contact_id
    salesperson_user_id:
      r.salesperson_user_id != null ? Number(r.salesperson_user_id) : null,
    odoo_currency: (r.currency_odoo as string | null) ?? null,
    moneda_fiscal: (r.currency_sat as string | null) ?? null,
    partner_name:
      (r.receptor_nombre as string | null) ??
      (r.emisor_nombre as string | null) ??
      null,
    company_id:
      r.receptor_canonical_company_id != null
        ? Number(r.receptor_canonical_company_id)
        : null,
    odoo_company_id:
      r.odoo_partner_id != null ? Number(r.odoo_partner_id) : null,
    emisor_rfc: (r.emisor_rfc as string | null) ?? null,
    receptor_rfc: (r.receptor_rfc as string | null) ?? null,
    emisor_blacklist_status:
      (r.emisor_blacklist_status as string | null) ?? null,
    receptor_blacklist_status:
      (r.receptor_blacklist_status as string | null) ?? null,
    fiscal_operational_consistency:
      r.state_mismatch != null
        ? (r.state_mismatch as boolean)
          ? "mismatch"
          : "consistent"
        : null,
    amount_diff:
      r.amount_total_mxn_diff_abs != null
        ? Number(r.amount_total_mxn_diff_abs)
        : null,
    odoo_ref: (r.odoo_ref as string | null) ?? null,
    email_id_origen: null, // not on canonical_invoices
  };
}

// ──────────────────────────────────────────────────────────────────────────
// getUnifiedInvoicesForCompany — SP5 canonical: reads canonical_invoices
// ──────────────────────────────────────────────────────────────────────────
export async function getUnifiedInvoicesForCompany(
  companyId: number,
  opts?: {
    direction?: "issued" | "received";
    includeNonComputable?: boolean;
  }
): Promise<UnifiedInvoice[]> {
  const supabase = getServiceClient();
  let q = supabase
    .from("canonical_invoices")
    .select("*")
    .or(
      `emisor_canonical_company_id.eq.${companyId},receptor_canonical_company_id.eq.${companyId}`
    );
  if (opts?.direction) q = q.eq("direction", opts.direction);
  if (!opts?.includeNonComputable) {
    q = q
      .in("match_confidence", ["match_uuid", "match_composite", "odoo_only"])
      .not("estado_sat", "eq", "cancelado");
  }
  const { data, error } = await q
    .order("invoice_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(
    mapCanonicalToUnified
  );
}

// ──────────────────────────────────────────────────────────────────────────
// getUnifiedRevenueAggregates — SP5 canonical: reads canonical_invoices
//
// 2026-04-25 schema fix: canonical_invoices.match_confidence values changed
// from {match_uuid, match_composite, odoo_only} to {exact, high, medium} +
// invoice_date can be null (use invoice_date_resolved). The previous filter
// silently excluded ~100% of recent rows. We now read every issued invoice
// in the date range and trust amount_total_mxn_resolved as the canonical
// monetary value.
// ──────────────────────────────────────────────────────────────────────────
export async function getUnifiedRevenueAggregates(
  fromDate: string,
  toDate: string,
  opts?: { companyId?: number }
): Promise<UnifiedRevenueAggregate> {
  const supabase = getServiceClient();
  let q = supabase
    .from("canonical_invoices")
    .select(
      "amount_total_mxn_odoo, amount_total_mxn_resolved, sat_uuid, estado_sat, direction, invoice_date_resolved, has_sat_record"
    )
    .eq("direction", "issued")
    // Tombstone filter: hide CFDIs from the CEO's personal Syntage account
    // (Mizrahi/Penhos/Ortiz/condominios). Backed by a trigger on
    // canonical_invoices that auto-flags new contaminants — see migration
    // 20260426_quimibond_relevance_tombstone.sql.
    .eq("is_quimibond_relevant", true)
    .gte("invoice_date_resolved", fromDate)
    .lte("invoice_date_resolved", toDate)
    .or("estado_sat.is.null,estado_sat.neq.cancelado");
  if (opts?.companyId) {
    q = q.or(
      `emisor_canonical_company_id.eq.${opts.companyId},receptor_canonical_company_id.eq.${opts.companyId}`
    );
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    amount_total_mxn_odoo: number | null;
    amount_total_mxn_resolved: number | null;
    sat_uuid: string | null;
    has_sat_record: boolean | null;
  }>;
  const revenue = rows.reduce(
    (s, r) =>
      s + Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo ?? 0),
    0
  );
  const count = rows.length;
  // SAT-validated = either has_sat_record true OR sat_uuid present (legacy fallback).
  const uuidValidated = rows.filter(
    (r) => r.has_sat_record === true || r.sat_uuid != null
  ).length;
  const pctValidated = count > 0 ? (uuidValidated / count) * 100 : 0;
  return { revenue, count, uuidValidated, pctValidated };
}

// ──────────────────────────────────────────────────────────────────────────
// getUnifiedCashFlowAging — SP5 canonical: reads canonical_invoices
// ──────────────────────────────────────────────────────────────────────────
export async function getUnifiedCashFlowAging(opts?: {
  companyId?: number;
}): Promise<UnifiedAgingBucket[]> {
  const supabase = getServiceClient();
  let q = supabase
    .from("canonical_invoices")
    .select(
      "amount_residual_mxn_odoo, due_date_odoo, match_confidence, estado_sat, state_odoo, direction, payment_state_odoo"
    )
    .eq("direction", "issued")
    // Tombstone filter (see migration 20260426).
    .eq("is_quimibond_relevant", true)
    .in("match_confidence", ["match_uuid", "match_composite", "odoo_only"])
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial", "in_payment"]);
  if (opts?.companyId) {
    q = q.or(
      `emisor_canonical_company_id.eq.${opts.companyId},receptor_canonical_company_id.eq.${opts.companyId}`
    );
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    amount_residual_mxn_odoo: number | null;
    due_date_odoo: string | null;
  }>;
  const buckets: Record<UnifiedAgingBucket["bucket"], UnifiedAgingBucket> = {
    "0-30": { bucket: "0-30", amount: 0, count: 0 },
    "31-60": { bucket: "31-60", amount: 0, count: 0 },
    "61-90": { bucket: "61-90", amount: 0, count: 0 },
    "90+": { bucket: "90+", amount: 0, count: 0 },
  };
  const today = Date.now();
  for (const r of rows) {
    const a = Number(r.amount_residual_mxn_odoo ?? 0);
    const d = r.due_date_odoo
      ? Math.floor((today - new Date(r.due_date_odoo).getTime()) / 86400000)
      : 0;
    const key: UnifiedAgingBucket["bucket"] =
      d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
    buckets[key].amount += a;
    buckets[key].count += 1;
  }
  return Object.values(buckets);
}

// ──────────────────────────────────────────────────────────────────────────
// getUnifiedReconciliationCounts — SP5: reconciliation_issues is a base table
// SP5-VERIFIED: reconciliation_issues is NOT in §12 drop list
// ──────────────────────────────────────────────────────────────────────────
export async function getUnifiedReconciliationCounts(
  companyId: number
): Promise<UnifiedReconciliationCounts> {
  const supabase = getServiceClient();
  // SP5-VERIFIED: reconciliation_issues is a base table (not in §12 drop list)
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("severity")
    .eq("company_id", companyId)
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ severity: Severity }>;
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const r of rows) bySeverity[r.severity] += 1;
  return { open: rows.length, bySeverity };
}

// ──────────────────────────────────────────────────────────────────────────
// getUnifiedRefreshStaleness — staleness via RPC (unchanged)
// ──────────────────────────────────────────────────────────────────────────

/** Raw implementation; exported for tests. */
export async function _getUnifiedRefreshStalenessRaw(): Promise<UnifiedRefreshStaleness> {
  // Defensive: this RPC has historically referenced legacy MVs that get
  // dropped in cleanup sprints (e.g. SP5 task 29 dropped invoices_unified +
  // payments_unified). A throw here cascades into every Server Component
  // that awaits this helper at the top of the page (e.g. /cobranza, /).
  // Always degrade to "unknown freshness" instead of breaking the page.
  const NEUTRAL: UnifiedRefreshStaleness = {
    invoicesRefreshedAt: null,
    paymentsRefreshedAt: null,
    minutesSinceRefresh: 99999,
  };
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc(
      "get_syntage_reconciliation_summary"
    );
    if (error) {
      console.error(
        "[getUnifiedRefreshStaleness] RPC error:",
        error.message
      );
      return NEUTRAL;
    }
    const d = (data ?? {}) as {
      invoices_unified_refreshed_at?: string | null;
      payments_unified_refreshed_at?: string | null;
    };
    const invRef = d.invoices_unified_refreshed_at ?? null;
    const payRef = d.payments_unified_refreshed_at ?? null;
    const refs = [invRef, payRef].filter((x): x is string => x != null);
    if (refs.length === 0) return NEUTRAL;
    const oldestRef = refs.sort()[0];
    const minutesSinceRefresh = Math.round(
      (Date.now() - new Date(oldestRef).getTime()) / 60_000
    );
    return {
      invoicesRefreshedAt: invRef,
      paymentsRefreshedAt: payRef,
      minutesSinceRefresh,
    };
  } catch (err) {
    console.error("[getUnifiedRefreshStaleness] threw:", err);
    return NEUTRAL;
  }
}

export const getUnifiedRefreshStaleness = unstable_cache(
  _getUnifiedRefreshStalenessRaw,
  ["unified-refresh-staleness-v2"],
  { revalidate: 60, tags: ["invoices-unified"] }
);
