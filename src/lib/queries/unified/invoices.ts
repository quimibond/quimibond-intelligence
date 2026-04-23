import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../_shared/_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * SP5 Task 11: rewired to canonical_invoices + canonical_payment_allocations.
 * Legacy MVs dropped: invoices_unified, unified_invoices, unified_payment_allocations.
 *
 * Schema notes (live-verified 2026-04-21):
 * - canonical_invoices: invoice_date (date), due_date_odoo (date), payment_state_odoo,
 *   match_confidence (not match_status), amount_residual_mxn_odoo (for open-balance),
 *   amount_total_mxn_resolved, estado_sat, salesperson_user_id, salesperson_contact_id
 *   (no salesperson_name column — returned as null back-compat).
 * - canonical_payment_allocations: invoice_canonical_id (FK to canonical_invoices),
 *   payment_canonical_id, allocated_amount, created_at.
 * - days_overdue: computed client-side from due_date_odoo (fiscal_days_to_due_date is NULL).
 * - cash_flow_aging: KEEP-listed view; used for company-level AR aging buckets.
 * - payment_predictions: KEEP-listed MV; unchanged.
 */

// SP5-VERIFIED: cash_flow_aging is in §12 KEEP list (not dropped)
// SP5-VERIFIED: payment_predictions is in §12 KEEP list (not dropped)
// SP5-VERIFIED: reconciliation_issues is a base table (not in §12 drop list)
// SP5-VERIFIED: ar_aging_detail is in §12 KEEP list (not dropped)

// ──────────────────────────────────────────────────────────────────────────
// listInvoices — SP5 canonical: reads canonical_invoices
// ──────────────────────────────────────────────────────────────────────────
export async function listInvoices(
  opts: {
    direction?: "issued" | "received";
    matchStatus?: string;
    canonicalCompanyId?: number;
    fromDate?: string;
    toDate?: string;
    onlyOpen?: boolean;
    onlyOverdue?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_invoices")
    .select("*")
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.matchStatus) q = q.eq("match_confidence", opts.matchStatus);
  if (typeof opts.canonicalCompanyId === "number") {
    q = q.or(
      `emisor_canonical_company_id.eq.${opts.canonicalCompanyId},receptor_canonical_company_id.eq.${opts.canonicalCompanyId}`
    );
  }
  if (opts.fromDate) q = q.gte("invoice_date", opts.fromDate);
  if (opts.toDate) q = q.lte("invoice_date", opts.toDate);
  if (opts.onlyOpen) q = q.gt("amount_residual_mxn_odoo", 0);
  if (opts.onlyOverdue) {
    const today = new Date().toISOString().slice(0, 10);
    q = q.lt("due_date_odoo", today).gt("amount_residual_mxn_odoo", 0);
  }
  if (opts.search)
    q = q.or(
      `sat_uuid.ilike.%${opts.search}%,odoo_ref.ilike.%${opts.search}%`
    );
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset)
    q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ──────────────────────────────────────────────────────────────────────────
// listAllocations — SP5 canonical: reads canonical_payment_allocations
// ──────────────────────────────────────────────────────────────────────────
export async function listAllocations(canonical_invoice_id: string) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_payment_allocations")
    .select("*")
    .eq("invoice_canonical_id", canonical_invoice_id)
    .order("created_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ──────────────────────────────────────────────────────────────────────────
// invoicesReceivableAging — SP5 canonical: derived from canonical_invoices
// ──────────────────────────────────────────────────────────────────────────
export async function invoicesReceivableAging(opts: { asOf?: string } = {}) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_invoices")
    .select("due_date_odoo, amount_residual_mxn_odoo")
    .eq("direction", "issued")
    .gt("amount_residual_mxn_odoo", 0);
  const today = new Date(opts.asOf ?? Date.now());
  const buckets: Record<string, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const r of (data ?? []) as Array<{
    due_date_odoo: string | null;
    amount_residual_mxn_odoo: number | null;
  }>) {
    const amt = Number(r.amount_residual_mxn_odoo ?? 0);
    const d = r.due_date_odoo
      ? Math.floor(
          (today.getTime() - new Date(r.due_date_odoo).getTime()) / 86400000
        )
      : 0;
    if (d <= 0) buckets.current += amt;
    else if (d <= 30) buckets["1-30"] += amt;
    else if (d <= 60) buckets["31-60"] += amt;
    else if (d <= 90) buckets["61-90"] += amt;
    else buckets["90+"] += amt;
  }
  return buckets;
}

// ──────────────────────────────────────────────────────────────────────────
// AR aging buckets — SP5 canonical: derived from ar_aging_detail (KEEP)
// ──────────────────────────────────────────────────────────────────────────
export interface ArAgingBucket {
  bucket: string; // "1-30" | "31-60" | "61-90" | "91-120" | "120+"
  count: number;
  amount_mxn: number;
}

const BUCKET_DEFS: Array<{
  label: string;
  min: number;
  max: number | null;
  sort: number;
}> = [
  { label: "1-30", min: 1, max: 30, sort: 1 },
  { label: "31-60", min: 31, max: 60, sort: 2 },
  { label: "61-90", min: 61, max: 90, sort: 3 },
  { label: "91-120", min: 91, max: 120, sort: 4 },
  { label: "120+", min: 121, max: null, sort: 5 },
];

async function _getArAgingRaw(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  // SP5-VERIFIED: ar_aging_detail is a KEEP-listed MV (§12 not in drop list)
  const { data } = await sb
    .from("ar_aging_detail")
    .select("days_overdue, amount_residual")
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds));

  const rows = (data ?? []) as Array<{
    days_overdue: number | null;
    amount_residual: number | null;
  }>;

  return BUCKET_DEFS.map((b) => {
    const inBucket = rows.filter((r) => {
      const d = Number(r.days_overdue) || 0;
      if (d < b.min) return false;
      if (b.max != null && d > b.max) return false;
      return true;
    });
    return {
      bucket: b.label,
      count: inBucket.length,
      amount_mxn: inBucket.reduce(
        (acc, r) => acc + (Number(r.amount_residual) || 0),
        0
      ),
    };
  });
}

export const getArAging = unstable_cache(
  _getArAgingRaw,
  ["invoices-ar-aging-v2"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

// ──────────────────────────────────────────────────────────────────────────
// Company aging — SP5: uses cash_flow_aging view (KEEP)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyAgingRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  current_amount: number;
  overdue_1_30: number;
  overdue_31_60: number;
  overdue_61_90: number;
  overdue_90plus: number;
  total_receivable: number;
  total_revenue: number;
}

export async function getCompanyAging(limit = 50): Promise<CompanyAgingRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  // SP5-VERIFIED: cash_flow_aging is a KEEP-listed view (§12 not in drop list)
  const { data } = await sb
    .from("cash_flow_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue"
    )
    .gt("total_receivable", 0)
    .not("company_id", "in", pgInList(selfIds))
    .order("total_receivable", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<CompanyAgingRow>>).map((r) => ({
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? null,
    tier: r.tier ?? null,
    current_amount: Number(r.current_amount) || 0,
    overdue_1_30: Number(r.overdue_1_30) || 0,
    overdue_31_60: Number(r.overdue_31_60) || 0,
    overdue_61_90: Number(r.overdue_61_90) || 0,
    overdue_90plus: Number(r.overdue_90plus) || 0,
    total_receivable: Number(r.total_receivable) || 0,
    total_revenue: Number(r.total_revenue) || 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue invoices — SP5 canonical: reads canonical_invoices
// ──────────────────────────────────────────────────────────────────────────
export interface OverdueInvoice {
  id: number;
  name: string | null;
  company_id: number | null;
  company_name: string | null;
  amount_total_mxn: number;
  amount_residual_mxn: number;
  currency: string | null;
  days_overdue: number | null;
  due_date: string | null;
  invoice_date: string | null;
  payment_state: string | null;
  salesperson_name: string | null; // NOTE: not on canonical_invoices; always null (SP6: join canonical_contacts)
  // SAT fields
  uuid_sat: string | null;
  estado_sat: string | null;
}

/** Compute days overdue from due_date_odoo (fiscal_days_to_due_date is NULL in canonical). */
function computeDaysOverdue(due_date_odoo: string | null): number | null {
  if (!due_date_odoo) return null;
  const d = Math.floor(
    (Date.now() - new Date(due_date_odoo).getTime()) / 86400000
  );
  return d > 0 ? d : 0;
}

type CanonicalInvoiceRow = {
  odoo_invoice_id: number | null;
  odoo_name: string | null;
  odoo_ref: string | null;
  receptor_canonical_company_id: number | null;
  amount_total_mxn_resolved: number | null;
  amount_total_mxn_odoo: number | null;
  amount_residual_mxn_odoo: number | null;
  currency_odoo: string | null;
  due_date_odoo: string | null;
  invoice_date: string | null;
  payment_state_odoo: string | null;
  salesperson_user_id: number | null;
  sat_uuid: string | null;
  estado_sat: string | null;
};

function mapOverdueRow(row: CanonicalInvoiceRow): OverdueInvoice {
  return {
    id: Number(row.odoo_invoice_id) || 0,
    name: row.odoo_name ?? row.odoo_ref,
    company_id: row.receptor_canonical_company_id,
    company_name: null, // SP6: join canonical_companies
    amount_total_mxn:
      Number(row.amount_total_mxn_resolved ?? row.amount_total_mxn_odoo) || 0,
    amount_residual_mxn: Number(row.amount_residual_mxn_odoo) || 0,
    currency: row.currency_odoo,
    days_overdue: computeDaysOverdue(row.due_date_odoo),
    due_date: row.due_date_odoo,
    invoice_date: row.invoice_date,
    payment_state: row.payment_state_odoo,
    salesperson_name: null, // canonical_invoices has salesperson_user_id only; SP6 join canonical_contacts
    uuid_sat: row.sat_uuid,
    estado_sat: row.estado_sat,
  };
}

const OVERDUE_SELECT =
  "odoo_invoice_id, odoo_name, odoo_ref, receptor_canonical_company_id, amount_total_mxn_resolved, amount_total_mxn_odoo, amount_residual_mxn_odoo, currency_odoo, due_date_odoo, invoice_date, payment_state_odoo, salesperson_user_id, sat_uuid, estado_sat";

async function _getOverdueInvoicesRaw(limit: number): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("canonical_invoices")
    .select(OVERDUE_SELECT)
    .eq("direction", "issued")
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .lt("due_date_odoo", today)
    .gt("amount_residual_mxn_odoo", 0)
    .not("receptor_canonical_company_id", "in", pgInList(selfIds))
    .order("amount_residual_mxn_odoo", { ascending: false, nullsFirst: false })
    .limit(limit);

  return ((data ?? []) as unknown as CanonicalInvoiceRow[]).map(mapOverdueRow);
}

const _getOverdueInvoicesCached = unstable_cache(
  _getOverdueInvoicesRaw,
  ["invoices-overdue-v2"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

export async function getOverdueInvoices(limit = 50): Promise<OverdueInvoice[]> {
  return _getOverdueInvoicesCached(limit);
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue invoices — paginated + filterable
// ──────────────────────────────────────────────────────────────────────────
export interface OverdueInvoicePage {
  rows: OverdueInvoice[];
  total: number;
}

const OVERDUE_SORT_MAP: Record<string, string> = {
  amount: "amount_residual_mxn_odoo",
  days: "due_date_odoo", // sort by due date as proxy for days overdue
  due: "due_date_odoo",
  invoice: "invoice_date",
  name: "odoo_name",
};

async function _getOverdueInvoicesPageRaw(
  params: TableParams & {
    bucket?: string[];
    salesperson?: string[];
  }
): Promise<OverdueInvoicePage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  const sortCol =
    (params.sort && OVERDUE_SORT_MAP[params.sort]) ?? "amount_residual_mxn_odoo";
  const ascending = params.sortDir === "asc";
  const [start, end] = paginationRange(params.page, params.size);
  const today = new Date().toISOString().slice(0, 10);

  let query = sb
    .from("canonical_invoices")
    .select(OVERDUE_SELECT, { count: "exact" })
    .eq("direction", "issued")
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .lt("due_date_odoo", today)
    .gt("amount_residual_mxn_odoo", 0)
    .not("receptor_canonical_company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("invoice_date", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("invoice_date", next);
  }
  if (params.q) query = query.ilike("odoo_name", `%${params.q}%`);
  // salesperson filter: canonical_invoices only has salesperson_user_id; name filter stubbed
  // (SP6: join canonical_contacts for name-based filter)

  if (params.bucket && params.bucket.length > 0) {
    // Compute client-side bucket filter via due_date_odoo ranges
    const orParts: string[] = [];
    const now = new Date();
    for (const b of params.bucket) {
      if (b === "1-30") {
        const d30 = new Date(now.getTime() - 30 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(
          `and(due_date_odoo.gte.${d30},due_date_odoo.lt.${today})`
        );
      } else if (b === "31-60") {
        const d31 = new Date(now.getTime() - 31 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d60 = new Date(now.getTime() - 60 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(
          `and(due_date_odoo.gte.${d60},due_date_odoo.lt.${d31})`
        );
      } else if (b === "61-90") {
        const d61 = new Date(now.getTime() - 61 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d90 = new Date(now.getTime() - 90 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(
          `and(due_date_odoo.gte.${d90},due_date_odoo.lt.${d61})`
        );
      } else if (b === "91-120") {
        const d91 = new Date(now.getTime() - 91 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d120 = new Date(now.getTime() - 120 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(
          `and(due_date_odoo.gte.${d120},due_date_odoo.lt.${d91})`
        );
      } else if (b === "120+") {
        const d121 = new Date(now.getTime() - 121 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`due_date_odoo.lt.${d121}`);
      } else if (b === "90+") {
        // 90+ merges old 91-120 + 120+ buckets into a single half-open lt filter.
        // Used by SP6-03 /cobranza UI which dropped the 90+ split.
        const d90 = new Date(now.getTime() - 90 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`due_date_odoo.lt.${d90}`);
      }
    }
    if (orParts.length > 0) query = query.or(orParts.join(","));
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as unknown as CanonicalInvoiceRow[]).map(
    mapOverdueRow
  );

  return { rows, total: count ?? rows.length };
}

export async function getOverdueInvoicesPage(
  params: TableParams & {
    bucket?: string[]; // "1-30" | "31-60" | "61-90" | "91-120" | "120+" | "90+"
    salesperson?: string[];
  }
): Promise<OverdueInvoicePage> {
  return _getOverdueInvoicesPageRaw(params);
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue salespeople options
// NOTE: canonical_invoices has salesperson_user_id (int) not salesperson_name.
// Returning empty array until SP6 adds canonical_contacts join.
// ──────────────────────────────────────────────────────────────────────────
async function _getOverdueSalespeopleOptionsRaw(): Promise<string[]> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  // Join via FK fk_ci_sp: canonical_invoices.salesperson_contact_id → canonical_contacts.id.
  // Use Supabase embed syntax. If the embed alias resolution ever fails (e.g., ambiguous
  // FK), fall back to a 2-pass query: distinct ids → batch fetch display_names.
  const { data } = await sb
    .from("canonical_invoices")
    .select("salesperson:canonical_contacts!fk_ci_sp(display_name)")
    .eq("direction", "issued")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .lt("due_date_odoo", today)
    .gt("amount_residual_mxn_odoo", 0)
    .not("salesperson_contact_id", "is", null);

  // Supabase generated types for embedded relations return an array even for
  // one-to-one FKs; runtime payload is the same single object PostgREST emits.
  // Cast through `unknown` to bypass the false-positive structural mismatch.
  const names = new Set<string>();
  type Row = { salesperson: { display_name: string | null } | null };
  for (const r of ((data ?? []) as unknown) as Row[]) {
    const name = r.salesperson?.display_name?.trim();
    if (name) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
}

export const getOverdueSalespeopleOptions = unstable_cache(
  _getOverdueSalespeopleOptionsRaw,
  ["invoices-overdue-salespeople-v2"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

// ──────────────────────────────────────────────────────────────────────────
// Company aging — paginated
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyAgingPage {
  rows: CompanyAgingRow[];
  total: number;
}

export async function getCompanyAgingPage(
  params: TableParams & { tier?: string[] }
): Promise<CompanyAgingPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortMap: Record<string, string> = {
    total: "total_receivable",
    revenue: "total_revenue",
    "1_30": "overdue_1_30",
    "31_60": "overdue_31_60",
    "61_90": "overdue_61_90",
    "90plus": "overdue_90plus",
    company: "company_name",
  };
  const sortCol = (params.sort && sortMap[params.sort]) ?? "total_receivable";
  const ascending = params.sortDir === "asc";

  // SP5-VERIFIED: cash_flow_aging is a KEEP-listed view (§12 not in drop list)
  let query = sb
    .from("cash_flow_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue",
      { count: "exact" }
    )
    .gt("total_receivable", 0)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.tier && params.tier.length > 0) {
    query = query.in("tier", params.tier);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<CompanyAgingRow>>).map((r) => ({
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? null,
    tier: r.tier ?? null,
    current_amount: Number(r.current_amount) || 0,
    overdue_1_30: Number(r.overdue_1_30) || 0,
    overdue_31_60: Number(r.overdue_31_60) || 0,
    overdue_61_90: Number(r.overdue_61_90) || 0,
    overdue_90plus: Number(r.overdue_90plus) || 0,
    total_receivable: Number(r.total_receivable) || 0,
    total_revenue: Number(r.total_revenue) || 0,
  }));

  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// Payment predictions — unchanged (KEEP-listed MV)
// ──────────────────────────────────────────────────────────────────────────
export interface PaymentPredictionRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  payment_risk: string;
  payment_trend: string | null;
  avg_days_to_pay: number | null;
  median_days_to_pay: number | null;
  max_days_overdue: number | null;
  total_pending: number;
  pending_count: number;
  predicted_payment_date: string | null;
}

export interface PaymentPredictionsPage {
  rows: PaymentPredictionRow[];
  total: number;
}

const PAYMENT_PREDICTION_SORT_MAP: Record<string, string> = {
  pending: "total_pending",
  max_overdue: "max_days_overdue",
  avg_days: "avg_days_to_pay",
  company: "company_name",
};

function mapPredRow(r: Partial<PaymentPredictionRow>): PaymentPredictionRow {
  return {
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? null,
    tier: r.tier ?? null,
    payment_risk: r.payment_risk ?? "—",
    payment_trend: r.payment_trend ?? null,
    avg_days_to_pay:
      r.avg_days_to_pay != null ? Number(r.avg_days_to_pay) : null,
    median_days_to_pay:
      r.median_days_to_pay != null ? Number(r.median_days_to_pay) : null,
    max_days_overdue:
      r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    total_pending: Number(r.total_pending) || 0,
    pending_count: Number(r.pending_count) || 0,
    predicted_payment_date: r.predicted_payment_date ?? null,
  };
}

const PRED_SELECT =
  "company_id, company_name, tier, payment_risk, payment_trend, avg_days_to_pay, median_days_to_pay, max_days_overdue, total_pending, pending_count, predicted_payment_date";

export async function getPaymentPredictionsPage(
  params: TableParams & { risk?: string[]; trend?: string[] }
): Promise<PaymentPredictionsPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && PAYMENT_PREDICTION_SORT_MAP[params.sort]) ?? "total_pending";
  const ascending = params.sortDir === "asc";

  // SP5-VERIFIED: payment_predictions is a KEEP-listed MV (§12 not in drop list)
  let query = sb
    .from("payment_predictions")
    .select(PRED_SELECT, { count: "exact" })
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.risk && params.risk.length > 0) {
    const orParts = params.risk.map((r) => `payment_risk.ilike.${r}%`);
    query = query.or(orParts.join(","));
  }
  if (params.trend && params.trend.length > 0) {
    query = query.in("payment_trend", params.trend);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<PaymentPredictionRow>>).map(
    mapPredRow
  );
  return { rows, total: count ?? rows.length };
}

export async function getPaymentPredictions(
  limit = 30
): Promise<PaymentPredictionRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  // SP5-VERIFIED: payment_predictions is a KEEP-listed MV (§12 not in drop list)
  const { data } = await sb
    .from("payment_predictions")
    .select(PRED_SELECT)
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds))
    .order("total_pending", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<PaymentPredictionRow>>).map(mapPredRow);
}

async function _getPaymentRiskKpisRaw(): Promise<{
  abnormalCount: number;
  abnormalPending: number;
  criticalCount: number;
  criticalPending: number;
}> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  // SP5-VERIFIED: payment_predictions is a KEEP-listed MV (§12 not in drop list)
  const { data } = await sb
    .from("payment_predictions")
    .select("payment_risk, total_pending")
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds));
  const rows = (data ?? []) as Array<{
    payment_risk: string | null;
    total_pending: number | null;
  }>;
  const abnormalPending = rows.reduce(
    (a, r) => a + (Number(r.total_pending) || 0),
    0
  );
  const critical = rows.filter((r) =>
    (r.payment_risk ?? "").toUpperCase().startsWith("CRITICO")
  );
  const criticalPending = critical.reduce(
    (a, r) => a + (Number(r.total_pending) || 0),
    0
  );
  return {
    abnormalCount: rows.length,
    abnormalPending,
    criticalCount: critical.length,
    criticalPending,
  };
}

export const getPaymentRiskKpis = unstable_cache(
  _getPaymentRiskKpisRaw,
  ["invoices-payment-risk-kpis-v2"],
  { revalidate: 60, tags: ["invoices-unified"] }
);
