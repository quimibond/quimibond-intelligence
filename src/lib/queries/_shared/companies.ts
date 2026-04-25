import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds } from "./_helpers";
import { paginationRange, type TableParams } from "./table-params";
import { getUnifiedInvoicesForCompany } from "@/lib/queries/unified";

/**
 * Companies queries — SP5 canonical layer:
 * - `canonical_companies` — golden company record (MDM-resolved)
 * - `gold_company_360` — enriched 360 view (revenue, AR/AP, deliveries, compliance)
 * - `canonical_invoices` — golden invoice records
 *
 * Schema drift notes vs SP5 plan:
 * - `rfc` (not `taxpayer_rfc`) — actual column name in canonical_companies
 * - `has_shadow_flag` (not `is_shadow`) — actual column name
 * - `gold_company_360` PK is `canonical_company_id` (not `id`)
 * - `amount_residual_mxn_odoo` used for open-balance filter pre-Task-24;
 *   `amount_residual_mxn_resolved` returned too for forward-compat (0% filled pre-Task-24)
 *
 * SP5 Task 3 (fixed): all 5 stub functions rewired to live canonical MVs.
 * canonical_sale_orders / canonical_purchase_orders / canonical_order_lines /
 * canonical_deliveries / canonical_manufacturing are all live (SP4, verified 2026-04-21).
 * Prior implementer incorrectly claimed these did not exist.
 */

// ──────────────────────────────────────────────────────────────────────────
// SP5 CANONICAL — new functions
// ──────────────────────────────────────────────────────────────────────────

export async function fetchCompanyById(id: number) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCompany360(canonical_company_id: number) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("gold_company_360")
    .select("*")
    .eq("canonical_company_id", canonical_company_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ListCompaniesOptions {
  search?: string;
  limit?: number;
  offset?: number;
  onlyCustomers?: boolean;
  onlySuppliers?: boolean;
  minLtv?: number;
  blacklistLevel?: "none" | "69b_presunto" | "69b_definitivo";
}

export async function listCompanies(opts: ListCompaniesOptions = {}) {
  const sb = getServiceClient();
  let q = sb.from("gold_company_360").select("*");
  if (opts.search) {
    q = q.or(`display_name.ilike.%${opts.search}%,rfc.ilike.%${opts.search}%`);
  }
  if (opts.onlyCustomers) q = q.eq("is_customer", true);
  if (opts.onlySuppliers) q = q.eq("is_supplier", true);
  if (typeof opts.minLtv === "number") q = q.gte("lifetime_value_mxn", opts.minLtv);
  if (opts.blacklistLevel) q = q.eq("blacklist_level", opts.blacklistLevel);
  q = q.order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset && opts.limit) q = q.range(opts.offset, opts.offset + opts.limit - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyInvoices(
  canonical_company_id: number,
  opts: { direction?: "issued" | "received"; limit?: number } = {},
) {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_invoices")
    .select(
      // SP5-NOTE: amount_residual_mxn_resolved is 0% pre-Task-24; amount_residual_mxn_odoo is the live value today
      "canonical_id, sat_uuid, direction, invoice_date, due_date_odoo, fiscal_days_to_due_date, amount_total_mxn_resolved, amount_residual_mxn_odoo, amount_residual_mxn_resolved, estado_sat, payment_state_odoo, match_confidence",
    )
    .or(
      `emisor_canonical_company_id.eq.${canonical_company_id},receptor_canonical_company_id.eq.${canonical_company_id}`,
    )
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyReceivables(canonical_company_id: number) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, invoice_date, due_date_odoo, fiscal_days_to_due_date, amount_total_mxn_resolved, amount_residual_mxn_odoo, amount_residual_mxn_resolved, payment_state_odoo",
    )
    .eq("direction", "issued")
    .eq("receptor_canonical_company_id", canonical_company_id)
    // SP5-NOTE: using amount_residual_mxn_odoo because _mxn_resolved is 0% filled pre-Task-24; Task 24 will switch this
    .gt("amount_residual_mxn_odoo", 0)
    .order("fiscal_days_to_due_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyPayables(canonical_company_id: number) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, invoice_date, due_date_odoo, fiscal_days_to_due_date, amount_total_mxn_resolved, amount_residual_mxn_odoo, amount_residual_mxn_resolved, payment_state_odoo",
    )
    .eq("direction", "received")
    .eq("emisor_canonical_company_id", canonical_company_id)
    .gt("amount_residual_mxn_odoo", 0)
    .order("fiscal_days_to_due_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// Back-compat aliases (for consumers being rewired in Tasks 13-17)
export const getCompanyById = fetchCompanyById;
export const getCompany360 = fetchCompany360;
export const searchCompanies = listCompanies;

// ──────────────────────────────────────────────────────────────────────────
// CompanyListRow — legacy shape preserved for consumer pages (Tasks 13-17).
// Now sourced from gold_company_360 (canonical). Field mapping:
//   company_id        ← canonical_company_id
//   name              ← display_name
//   total_revenue     ← lifetime_value_mxn (closest canonical proxy; was company_profile.total_revenue)
//   revenue_90d       ← revenue_90d_mxn
//   overdue_amount    ← overdue_amount_mxn
//   last_order_date   ← last_invoice_date (no last_order_date in gold_company_360; SP6 will fix when
//                        canonical_sale_orders exists)
//   pareto_class      ← null (portfolio_concentration dropped in SP1; no canonical equivalent)
//   customer_status   ← null (same)
//   churn_risk_score  ← null (customer_ltv_health dropped in SP1; no canonical equivalent)
//   total_invoiced_sat / _ytd ← null (company_profile_sat dropped; canonical has total_invoiced_sat_mxn
//                               on canonical_companies but not surfaced in gold_360 as separate YTD)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyListRow {
  company_id: number;
  name: string;
  tier: string | null;
  risk_level: string | null;
  pareto_class: string | null;
  customer_status: string | null;
  total_revenue: number;
  revenue_90d: number;
  trend_pct: number;
  overdue_amount: number;
  max_days_overdue: number | null;
  otd_rate: number | null;
  last_order_date: string | null;
  churn_risk_score: number | null;
  // SAT fiscal metrics (from company_profile_sat — now null; SP6 will restore from canonical)
  total_invoiced_sat: number | null;
  total_invoiced_sat_ytd: number | null;
}

// gold_company_360 row shape (subset used here)
interface Gold360Row {
  canonical_company_id: number;
  display_name: string;
  tier: string | null;
  risk_level: string | null;
  lifetime_value_mxn: number | null;
  revenue_90d_mxn: number | null;
  trend_pct: number | null;
  overdue_amount_mxn: number | null;
  max_days_overdue: number | null;
  otd_rate: number | null;
  last_invoice_date: string | null;
  is_customer: boolean | null;
  is_internal: boolean | null;
}

function mapGold360ToListRow(r: Gold360Row): CompanyListRow {
  return {
    company_id: r.canonical_company_id,
    name: r.display_name,
    tier: r.tier ?? null,
    risk_level: r.risk_level ?? null,
    pareto_class: null, // TODO SP6: restore from canonical pareto when portfolio_concentration equivalent exists
    customer_status: null, // TODO SP6: restore when portfolio_concentration equivalent exists
    total_revenue: Number(r.lifetime_value_mxn) || 0,
    revenue_90d: Number(r.revenue_90d_mxn) || 0,
    trend_pct: Number(r.trend_pct) || 0,
    overdue_amount: Number(r.overdue_amount_mxn) || 0,
    max_days_overdue: r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    otd_rate: r.otd_rate != null ? Number(r.otd_rate) : null,
    last_order_date: r.last_invoice_date ?? null, // proxy; TODO SP6: use canonical_sale_orders.date_order
    churn_risk_score: null, // TODO SP6: restore from canonical LTV table when available
    total_invoiced_sat: null, // TODO SP6: restore from canonical_companies.total_invoiced_sat_mxn breakdown
    total_invoiced_sat_ytd: null, // TODO SP6: same
  };
}

export async function getCompaniesList(limit = 100): Promise<CompanyListRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  let q = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, tier, risk_level, lifetime_value_mxn, revenue_90d_mxn, trend_pct, overdue_amount_mxn, max_days_overdue, otd_rate, last_invoice_date, is_customer, is_internal",
    )
    .gt("lifetime_value_mxn", 0)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (selfIds.length > 0) {
    q = q.not("canonical_company_id", "in", `(${selfIds.join(",")})`);
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((r) => mapGold360ToListRow(r as Gold360Row));
}

// ──────────────────────────────────────────────────────────────────────────
// Companies paginadas + filtrables (para listado con toolbar)
// ──────────────────────────────────────────────────────────────────────────
export interface CompaniesPage {
  rows: CompanyListRow[];
  total: number;
}

const COMPANIES_SORT_MAP: Record<string, string> = {
  revenue: "lifetime_value_mxn",
  revenue_90d: "revenue_90d_mxn",
  trend: "trend_pct",
  overdue: "overdue_amount_mxn",
  name: "display_name",
  last_order: "last_invoice_date",
  otd: "otd_rate",
};

export async function getCompaniesPage(
  params: TableParams & {
    tier?: string[];
    risk?: string[];
  },
): Promise<CompaniesPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol = (params.sort && COMPANIES_SORT_MAP[params.sort]) ?? "lifetime_value_mxn";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, tier, risk_level, lifetime_value_mxn, revenue_90d_mxn, trend_pct, overdue_amount_mxn, max_days_overdue, otd_rate, last_invoice_date, is_customer, is_internal",
      { count: "exact" },
    )
    .gt("lifetime_value_mxn", 0);

  if (selfIds.length > 0) {
    query = query.not("canonical_company_id", "in", `(${selfIds.join(",")})`);
  }

  if (params.q) query = query.ilike("display_name", `%${params.q}%`);
  if (params.tier && params.tier.length > 0) {
    query = query.in("tier", params.tier);
  }
  if (params.risk && params.risk.length > 0) {
    query = query.in("risk_level", params.risk);
  }
  // Period filter by last_invoice_date (proxy for last_order_date; TODO SP6: switch to canonical_sale_orders)
  if (params.from) query = query.gte("last_invoice_date", params.from);
  if (params.to) query = query.lt("last_invoice_date", params.to);

  const { data, count, error } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  if (error) throw error;

  const rows = (data ?? []).map((r) => mapGold360ToListRow(r as Gold360Row));
  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// COMPANY 360 detail — reads canonical_companies + gold_company_360
// Replaces legacy reads of: companies, company_profile, company_narrative,
// customer_ltv_health, company_profile_sat (all dropped in SP1)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyDetail {
  id: number;
  name: string;
  canonicalName: string | null;
  rfc: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  creditLimit: number | null;
  paymentTerm: string | null;
  // Narrative extras (sourced from canonical_companies fields; company_narrative MV dropped in SP1)
  tier: string | null;
  riskLevel: string | null;
  // Revenue metrics
  totalRevenue: number;
  revenue90d: number;
  revenue12m: number;
  revenue3m: number;
  trendPct: number;
  monthlyAvg: number;
  // Orders
  totalOrders: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  // Cobranza
  pendingAmount: number;
  overdueAmount: number;
  maxDaysOverdue: number | null;
  overdueCount: number;
  // Deliveries
  totalDeliveries: number;
  lateDeliveries: number;
  otdRate: number | null;
  // LTV
  ltvMxn: number | null;
  churnRiskScore: number | null;
  overdueRiskScore: number | null;
  // SAT fiscal metrics (sourced from canonical_companies; ytd breakdown null until SP6 Task 24)
  totalInvoicedSat: number | null;
  totalInvoicedSatYtd: number | null;
  totalInvoicedSatGross: number | null;
  totalCancelledInvoiced: number | null;
  totalCreditNotes: number | null;
  totalReceivedSat: number | null;
  lastSatInvoiceDate: string | null;
  // Comms (sourced from gold_company_360; per-message breakdown null until SP6)
  emailCount: number;
  emails30d: number;
  lastEmailDate: string | null;
  complaints: number;
  commitments: number;
  requests: number;
  recentComplaints: string | null;
  // Team
  salespeople: string | null;
  topProducts: string | null;
  // M8: self/internal flag
  isSelf: boolean;
}

export async function getCompanyDetail(id: number): Promise<CompanyDetail | null> {
  const sb = getServiceClient();

  // Resolve canonical_companies row first (id = canonical_companies.id)
  const { data: cc, error: ccErr } = await sb
    .from("canonical_companies")
    .select(
      "id, canonical_name, display_name, rfc, industry, city, country, is_customer, is_supplier, credit_limit, payment_term, relationship_type, tier, risk_level, lifetime_value_mxn, revenue_ytd_mxn, revenue_90d_mxn, revenue_prior_90d_mxn, trend_pct, total_invoiced_odoo_mxn, total_invoiced_sat_mxn, total_credit_notes_mxn, invoices_count, last_invoice_date, total_receivable_mxn, total_payable_mxn, total_pending_mxn, overdue_amount_mxn, overdue_count, max_days_overdue, total_deliveries_count, late_deliveries_count, otd_rate, email_count, last_email_at, key_products, enriched_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (ccErr) throw ccErr;
  if (!cc) return null;

  // Fetch gold_company_360 for additional enriched fields
  const { data: g360 } = await sb
    .from("gold_company_360")
    .select(
      "sales_orders_12m, relationship_summary, sat_compliance_score, sat_open_issues_count",
    )
    .eq("canonical_company_id", id)
    .maybeSingle();

  // Derive salespeople from canonical_sale_orders (distinct salesperson_name for this company)
  const { data: spRows } = await sb
    .from("canonical_sale_orders")
    .select("salesperson_name")
    .eq("canonical_company_id", id)
    .not("salesperson_name", "is", null)
    .order("salesperson_name", { ascending: true });
  const uniqueSalespeople = [...new Set((spRows ?? []).map((r) => r.salesperson_name).filter(Boolean))];
  const salespeopleStr = uniqueSalespeople.length > 0 ? uniqueSalespeople.join(", ") : null;

  // Derive SAT fiscal YTD / gross / cancelled / received from canonical_invoices
  const ytdStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const { data: satRows } = await sb
    .from("canonical_invoices")
    .select("direction, estado_sat, amount_total_mxn_resolved, invoice_date")
    .eq("emisor_canonical_company_id", id)
    .eq("direction", "issued")
    .not("sat_uuid", "is", null);

  let totalInvoicedSatGross = 0;
  let totalInvoicedSatYtd = 0;
  let totalInvoicedSatCancelled = 0;
  let totalInvoicedSatReceived = 0;
  for (const r of satRows ?? []) {
    const amt = Number(r.amount_total_mxn_resolved ?? 0);
    if (r.estado_sat === "cancelado") {
      totalInvoicedSatCancelled += amt;
    } else {
      // vigente or null-estado (timbrado but not cancelled)
      totalInvoicedSatGross += amt;
      if (r.invoice_date && r.invoice_date >= ytdStart) {
        totalInvoicedSatYtd += amt;
      }
    }
  }
  // received = purchase-side (we are receptor)
  const { data: satReceivedRows } = await sb
    .from("canonical_invoices")
    .select("amount_total_mxn_resolved")
    .eq("receptor_canonical_company_id", id)
    .eq("direction", "received")
    .not("sat_uuid", "is", null)
    .neq("estado_sat", "cancelado");
  for (const r of satReceivedRows ?? []) {
    totalInvoicedSatReceived += Number(r.amount_total_mxn_resolved ?? 0);
  }

  const c = cc as {
    id: number;
    canonical_name: string | null;
    display_name: string;
    rfc: string | null;
    industry: string | null;
    city: string | null;
    country: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
    credit_limit: number | null;
    payment_term: string | null;
    relationship_type: string | null;
    tier: string | null;
    risk_level: string | null;
    lifetime_value_mxn: number | null;
    revenue_ytd_mxn: number | null;
    revenue_90d_mxn: number | null;
    revenue_prior_90d_mxn: number | null;
    trend_pct: number | null;
    total_invoiced_odoo_mxn: number | null;
    total_invoiced_sat_mxn: number | null;
    total_credit_notes_mxn: number | null;
    invoices_count: number | null;
    last_invoice_date: string | null;
    total_receivable_mxn: number | null;
    total_payable_mxn: number | null;
    total_pending_mxn: number | null;
    overdue_amount_mxn: number | null;
    overdue_count: number | null;
    max_days_overdue: number | null;
    total_deliveries_count: number | null;
    late_deliveries_count: number | null;
    otd_rate: number | null;
    email_count: number | null;
    last_email_at: string | null;
    key_products: string | null;
    enriched_at: string | null;
  };

  const g = (g360 ?? {}) as Partial<{
    sales_orders_12m: number;
    relationship_summary: string;
    sat_compliance_score: number;
    sat_open_issues_count: number;
  }>;

  // Compute days since last order (proxy: last_invoice_date)
  const lastDate = c.last_invoice_date;
  let daysSinceLastOrder: number | null = null;
  if (lastDate) {
    const diff = Date.now() - new Date(lastDate).getTime();
    daysSinceLastOrder = Math.floor(diff / 86_400_000);
  }

  // Monthly average revenue (lifetime / 12 as rough proxy; TODO SP6: use actual month count)
  const monthlyAvg = c.lifetime_value_mxn != null ? Number(c.lifetime_value_mxn) / 12 : 0;

  return {
    id: c.id,
    name: c.display_name,
    canonicalName: c.canonical_name,
    rfc: c.rfc,
    industry: c.industry,
    city: c.city,
    country: c.country,
    isCustomer: !!c.is_customer,
    isSupplier: !!c.is_supplier,
    creditLimit: c.credit_limit,
    paymentTerm: c.payment_term,
    tier: c.tier ?? null,
    riskLevel: c.risk_level ?? null,
    totalRevenue: Number(c.lifetime_value_mxn) || 0,
    revenue90d: Number(c.revenue_90d_mxn) || 0,
    revenue12m: Number(c.revenue_ytd_mxn) || 0, // YTD as proxy for trailing 12m
    revenue3m: Number(c.revenue_90d_mxn) || 0, // 90d as proxy for 3m
    trendPct: Number(c.trend_pct) || 0,
    monthlyAvg,
    totalOrders: Number(g.sales_orders_12m) || 0,
    lastOrderDate: c.last_invoice_date ?? null, // proxy; TODO SP6: use canonical_sale_orders
    daysSinceLastOrder,
    pendingAmount: Number(c.total_pending_mxn) || 0,
    overdueAmount: Number(c.overdue_amount_mxn) || 0,
    maxDaysOverdue: c.max_days_overdue != null ? Number(c.max_days_overdue) : null,
    overdueCount: Number(c.overdue_count) || 0,
    totalDeliveries: Number(c.total_deliveries_count) || 0,
    lateDeliveries: Number(c.late_deliveries_count) || 0,
    otdRate: c.otd_rate != null ? Number(c.otd_rate) : null,
    ltvMxn: c.lifetime_value_mxn != null ? Number(c.lifetime_value_mxn) : null,
    churnRiskScore: null, // TODO SP6: no canonical churn_risk_score; customer_ltv_health dropped SP1
    overdueRiskScore: null, // TODO SP6: same
    emailCount: Number(c.email_count) || 0,
    emails30d: 0, // TODO SP6: company_narrative dropped SP1; no 30d email breakdown in canonical yet
    lastEmailDate: c.last_email_at ?? null,
    complaints: 0, // TODO SP6: company_narrative dropped SP1
    commitments: 0, // TODO SP6: same
    requests: 0, // TODO SP6: same
    recentComplaints: null, // TODO SP6: same
    salespeople: salespeopleStr,
    topProducts: c.key_products ?? null,
    isSelf: c.relationship_type === "self",
    // SAT fiscal: derived from canonical_invoices (UUID-stamped invoices only)
    totalInvoicedSat: c.total_invoiced_sat_mxn != null ? Number(c.total_invoiced_sat_mxn) : null,
    totalInvoicedSatYtd: totalInvoicedSatYtd > 0 ? totalInvoicedSatYtd : null,
    totalInvoicedSatGross: totalInvoicedSatGross > 0 ? totalInvoicedSatGross : null,
    totalCancelledInvoiced: totalInvoicedSatCancelled > 0 ? totalInvoicedSatCancelled : null,
    totalCreditNotes: c.total_credit_notes_mxn != null ? Number(c.total_credit_notes_mxn) : null,
    totalReceivedSat: totalInvoicedSatReceived > 0 ? totalInvoicedSatReceived : null,
    lastSatInvoiceDate: c.last_invoice_date ?? null, // proxy; TODO SP6: use SAT invoice date
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Company Orders — reads canonical_sale_orders MV (SP4 Task 2, 6.8 MB live)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyOrderRow {
  id: number;
  name: string | null;
  date_order: string | null;
  amount_total_mxn: number | null;
  state: string | null;
  salesperson_name: string | null;
}

export interface CompanyOrdersPage {
  rows: CompanyOrderRow[];
  total: number;
}

const ORDERS_SORT_MAP: Record<string, string> = {
  date: "date_order",
  amount: "amount_total_mxn",
  name: "name",
  state: "state",
  salesperson: "salesperson_name",
};

function mapSaleOrderRow(r: {
  canonical_id: number;
  name: string | null;
  date_order: string | null;
  amount_total_mxn: number | null;
  state: string | null;
  salesperson_name: string | null;
}): CompanyOrderRow {
  return {
    id: r.canonical_id,
    name: r.name,
    date_order: r.date_order,
    amount_total_mxn: r.amount_total_mxn != null ? Number(r.amount_total_mxn) : null,
    state: r.state,
    salesperson_name: r.salesperson_name,
  };
}

export async function getCompanyOrdersPage(
  companyId: number,
  params: import("./table-params").TableParams & { state?: string[] },
): Promise<CompanyOrdersPage> {
  const sb = getServiceClient();
  const { paginationRange } = await import("./table-params");
  const [start, end] = paginationRange(params.page, params.size);
  const ascending = params.sortDir === "asc";
  const sortCol = (params.sort && ORDERS_SORT_MAP[params.sort]) ?? "date_order";

  let q = sb
    .from("canonical_sale_orders")
    .select(
      "canonical_id, name, date_order, amount_total_mxn, state, salesperson_name",
      { count: "exact" },
    )
    .eq("canonical_company_id", companyId);

  if (params.q) q = q.ilike("name", `%${params.q}%`);
  if (params.from) q = q.gte("date_order", params.from);
  if (params.to) q = q.lt("date_order", params.to);
  if (params.state && params.state.length > 0) q = q.in("state", params.state);

  const { data, count, error } = await q
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);
  if (error) throw error;

  const rows = (data ?? []).map(mapSaleOrderRow);
  return { rows, total: count ?? rows.length };
}

export async function getCompanyOrders(
  companyId: number,
  limit = 15,
): Promise<CompanyOrderRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_sale_orders")
    .select("canonical_id, name, date_order, amount_total_mxn, state, salesperson_name")
    .eq("canonical_company_id", companyId)
    .order("date_order", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapSaleOrderRow);
}

// ──────────────────────────────────────────────────────────────────────────
// Company Invoices — delegates to getUnifiedInvoicesForCompany (no legacy reads)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyInvoiceRow {
  id: number;
  name: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_total_mxn: number | null;
  amount_residual_mxn: number | null;
  currency: string | null;
  payment_state: string | null;
  days_overdue: number | null;
}

export interface CompanyInvoicesPage {
  rows: CompanyInvoiceRow[];
  total: number;
}

export async function getCompanyInvoicesPage(
  companyId: number,
  params: import("./table-params").TableParams & { payment_state?: string[] },
): Promise<CompanyInvoicesPage> {
  const { paginationRange, endOfDay } = await import("./table-params");
  const [start, end] = paginationRange(params.page, params.size);
  const ascending = params.sortDir === "asc";
  const sortMap: Record<string, string> = {
    date: "invoice_date",
    due: "due_date",
    amount: "odoo_amount_total",
    residual: "amount_residual",
    days: "days_overdue",
  };
  const sortKey = (params.sort && sortMap[params.sort]) ?? "invoice_date";

  let rows = await getUnifiedInvoicesForCompany(companyId, {
    direction: "issued",
    includeNonComputable: true,
  });

  // Apply filters
  if (params.q) {
    const q = params.q.toLowerCase();
    rows = rows.filter((r) => r.odoo_ref?.toLowerCase().includes(q) ?? false);
  }
  if (params.payment_state && params.payment_state.length > 0) {
    const states = new Set(params.payment_state);
    rows = rows.filter((r) => r.payment_state && states.has(r.payment_state));
  }
  if (params.from) rows = rows.filter((r) => (r.invoice_date ?? "") >= params.from!);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) rows = rows.filter((r) => (r.invoice_date ?? "") < next);
  }

  const total = rows.length;

  // Sort
  rows.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey] as string | number | null;
    const bv = (b as unknown as Record<string, unknown>)[sortKey] as string | number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return ascending ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
  });

  // Paginate
  const page = rows.slice(start, end + 1);

  const mapped: CompanyInvoiceRow[] = page.map((r) => ({
    id: r.odoo_invoice_id ?? 0,
    name: r.odoo_ref,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    amount_total_mxn: r.odoo_amount_total,
    amount_residual_mxn: r.amount_residual,
    currency: r.odoo_currency,
    payment_state: r.payment_state,
    days_overdue: r.days_overdue,
  }));

  return { rows: mapped, total };
}

export async function getCompanyInvoices(
  companyId: number,
  limit = 20,
): Promise<CompanyInvoiceRow[]> {
  const rows = await getUnifiedInvoicesForCompany(companyId, {
    direction: "issued",
    includeNonComputable: true,
  });
  return rows.slice(0, limit).map((r) => ({
    id: r.odoo_invoice_id ?? 0,
    name: r.odoo_ref,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    amount_total_mxn: r.odoo_amount_total,
    amount_residual_mxn: r.amount_residual,
    currency: r.odoo_currency,
    payment_state: r.payment_state,
    days_overdue: r.days_overdue,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Company Deliveries — reads canonical_deliveries MV (SP4 Task 5, 6.5 MB live)
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyDeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  scheduled_date: string | null;
  date_done: string | null;
  state: string | null;
  is_late: boolean | null;
}

export interface CompanyDeliveriesPage {
  rows: CompanyDeliveryRow[];
  total: number;
}

const DELIVERIES_SORT_MAP: Record<string, string> = {
  date: "scheduled_date",
  done: "date_done",
  name: "name",
  state: "state",
  type: "picking_type_code",
};

function mapDeliveryRow(r: {
  canonical_id: number;
  name: string | null;
  picking_type_code: string | null;
  scheduled_date: string | null;
  date_done: string | null;
  state: string | null;
  is_late: boolean | null;
}): CompanyDeliveryRow {
  return {
    id: r.canonical_id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    scheduled_date: r.scheduled_date,
    date_done: r.date_done,
    state: r.state,
    is_late: r.is_late,
  };
}

export async function getCompanyDeliveriesPage(
  companyId: number,
  params: import("./table-params").TableParams & { state?: string[] },
): Promise<CompanyDeliveriesPage> {
  const sb = getServiceClient();
  const { paginationRange } = await import("./table-params");
  const [start, end] = paginationRange(params.page, params.size);
  const ascending = params.sortDir === "asc";
  const sortCol = (params.sort && DELIVERIES_SORT_MAP[params.sort]) ?? "scheduled_date";

  let q = sb
    .from("canonical_deliveries")
    .select(
      "canonical_id, name, picking_type_code, scheduled_date, date_done, state, is_late",
      { count: "exact" },
    )
    .eq("canonical_company_id", companyId);

  if (params.q) q = q.ilike("name", `%${params.q}%`);
  if (params.from) q = q.gte("scheduled_date", params.from);
  if (params.to) q = q.lt("scheduled_date", params.to);
  if (params.state && params.state.length > 0) q = q.in("state", params.state);

  const { data, count, error } = await q
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);
  if (error) throw error;

  const rows = (data ?? []).map(mapDeliveryRow);
  return { rows, total: count ?? rows.length };
}

export async function getCompanyDeliveries(
  companyId: number,
  limit = 15,
): Promise<CompanyDeliveryRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_deliveries")
    .select("canonical_id, name, picking_type_code, scheduled_date, date_done, state, is_late")
    .eq("canonical_company_id", companyId)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapDeliveryRow);
}

// ──────────────────────────────────────────────────────────────────────────
// Company Top Products — reads canonical_order_lines MV (SP4 Task 4, 20 MB live)
// Groups by canonical_product_id, aggregates qty + revenue, returns top N.
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyProductRow {
  product_ref: string | null;
  product_name: string | null;
  total_qty: number;
  total_revenue: number;
  last_order_date: string | null;
}

/**
 * Top productos vendidos a esta empresa, derivados de canonical_order_lines.
 * Fetches up to 2000 sale lines for the company, groups client-side by canonical_product_id.
 */
export async function getCompanyTopProducts(
  companyId: number,
  limit = 10,
): Promise<CompanyProductRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_order_lines")
    .select("canonical_product_id, product_ref, product_name, qty, subtotal_mxn, order_date")
    .eq("order_type", "sale")
    .eq("canonical_company_id", companyId)
    .limit(2000);
  if (error) throw error;

  const byProduct: Record<
    number,
    { product_ref: string | null; product_name: string | null; n: number; totalQty: number; totalRevenue: number; lastAt: string | null }
  > = {};
  for (const r of data ?? []) {
    const p = Number(r.canonical_product_id);
    if (!p) continue;
    byProduct[p] ??= { product_ref: r.product_ref ?? null, product_name: r.product_name ?? null, n: 0, totalQty: 0, totalRevenue: 0, lastAt: null };
    byProduct[p].n += 1;
    byProduct[p].totalQty += Number(r.qty ?? 0);
    byProduct[p].totalRevenue += Number(r.subtotal_mxn ?? 0);
    if (!byProduct[p].lastAt || (r.order_date && r.order_date > byProduct[p].lastAt!)) {
      byProduct[p].lastAt = r.order_date as string | null;
    }
  }

  return Object.values(byProduct)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit)
    .map((p) => ({
      product_ref: p.product_ref,
      product_name: p.product_name,
      total_qty: p.totalQty,
      total_revenue: p.totalRevenue,
      last_order_date: p.lastAt,
    }));
}

// ──────────────────────────────────────────────────────────────────────────
// Company Activities — SP5-EXCEPTION: odoo_activities has no canonical counterpart in SP4 scope.
// Kept as Bronze read per task spec; annotated for SP6 raise.
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyActivityRow {
  id: number;
  activity_type: string | null;
  summary: string | null;
  date_deadline: string | null;
  assigned_to: string | null;
  is_overdue: boolean | null;
}

export async function getCompanyActivities(
  companyId: number,
  limit = 10,
): Promise<CompanyActivityRow[]> {
  const sb = getServiceClient();
  const { data } = await sb.from("odoo_activities") // SP5-EXCEPTION: no canonical_activities in SP4 scope; raise for SP6
    .select("id, activity_type, summary, date_deadline, assigned_to, is_overdue")
    .eq("company_id", companyId)
    .order("date_deadline", { ascending: true })
    .limit(limit);
  return (data ?? []) as CompanyActivityRow[];
}

export interface PortfolioKpis {
  lifetime_value_mxn_total: number;
  customers_count: number;
  suppliers_count: number;
  blacklist_count: number;
}

/**
 * Portfolio-level aggregates over gold_company_360.
 * Used by the /empresas list header — NOT filtered by user filters
 * (those only affect the table, KPIs stay portfolio-wide).
 */
export async function fetchPortfolioKpis(): Promise<PortfolioKpis> {
  const sb = getServiceClient();

  const [
    { count: customersCount },
    { count: suppliersCount },
    { count: blacklistCount },
    { data: sumRows },
  ] = await Promise.all([
    sb.from("gold_company_360").select("canonical_company_id", { head: true, count: "exact" }).eq("is_customer", true),
    sb.from("gold_company_360").select("canonical_company_id", { head: true, count: "exact" }).eq("is_supplier", true),
    sb.from("gold_company_360").select("canonical_company_id", { head: true, count: "exact" }).neq("blacklist_level", "none"),
    sb.from("gold_company_360").select("lifetime_value_mxn"),
  ]);

  const ltvTotal = (sumRows ?? []).reduce((acc, r) => acc + (r.lifetime_value_mxn ?? 0), 0);

  return {
    lifetime_value_mxn_total: ltvTotal,
    customers_count: customersCount ?? 0,
    suppliers_count: suppliersCount ?? 0,
    blacklist_count: blacklistCount ?? 0,
  };
}

export interface RevenueTrendPoint {
  month_start: string;
  total_mxn: number;
}

/**
 * Revenue trend for a single company over the last N months.
 * Reads gold_revenue_monthly filtered by canonical_company_id.
 * Returns points in chronological order (oldest first).
 *
 * gold_revenue_monthly does not expose a `total_mxn` column — the canonical
 * choice is `resolved_mxn` (best dual-source: SAT preferred, falls back to
 * Odoo). Selecting the wrong column previously failed silently because the
 * page-level `.catch(() => [])` in /empresas/[id] swallowed the 400.
 */
export async function fetchCompanyRevenueTrend(
  canonicalCompanyId: number,
  months: number = 12,
): Promise<RevenueTrendPoint[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await sb
    .from("gold_revenue_monthly")
    .select("month_start, resolved_mxn")
    .eq("canonical_company_id", canonicalCompanyId)
    .gte("month_start", since.toISOString())
    .order("month_start", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({
    month_start: r.month_start ?? "",
    total_mxn: Number(r.resolved_mxn) || 0,
  }));
}
