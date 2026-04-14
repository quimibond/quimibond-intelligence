import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "./_helpers";

/**
 * Companies queries v2 — usa views canónicas:
 * - `company_profile` (MV) — perfil consolidado por empresa
 * - `company_narrative` (MV) — resumen narrativo extendido (complaints, top_products, etc.)
 * - `customer_ltv_health` (MV) — LTV, churn_risk_score, overdue_risk_score
 * - `portfolio_concentration` (MV) — pareto_class (A/B/C), customer_status, rank
 * - `cash_flow_aging` (view) — buckets AR por empresa
 * - `companies` (base) — enrichment fields, strategic_notes, key_products
 */

// ──────────────────────────────────────────────────────────────────────────
// LIST page
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
}

export async function getCompaniesList(
  limit = 100
): Promise<CompanyListRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("company_profile")
    .select(
      "company_id, name, tier, risk_level, total_revenue, revenue_90d, trend_pct, overdue_amount, max_days_overdue, otd_rate, last_order_date"
    )
    .gt("total_revenue", 0)
    .not("company_id", "in", pgInList(selfIds))
    .order("total_revenue", { ascending: false })
    .limit(limit);

  const baseRows = (data ?? []) as Array<Omit<
    CompanyListRow,
    "pareto_class" | "customer_status" | "churn_risk_score"
  >>;

  if (baseRows.length === 0) return [];

  const ids = baseRows.map((r) => r.company_id);

  const [pareto, ltv] = await Promise.all([
    sb
      .from("portfolio_concentration")
      .select("company_id, pareto_class, customer_status")
      .in("company_id", ids),
    sb
      .from("customer_ltv_health")
      .select("company_id, churn_risk_score")
      .in("company_id", ids),
  ]);

  // Normaliza "A (top 80%)" → "A", "B (80-95%)" → "B", "C (tail)" → "C"
  const normalizePareto = (raw: string | null): "A" | "B" | "C" | null => {
    if (!raw) return null;
    const first = raw.trim().charAt(0).toUpperCase();
    if (first === "A" || first === "B" || first === "C") return first;
    return null;
  };

  const paretoMap = new Map<
    number,
    { pareto_class: string | null; customer_status: string | null }
  >();
  for (const p of (pareto.data ?? []) as Array<{
    company_id: number;
    pareto_class: string | null;
    customer_status: string | null;
  }>) {
    paretoMap.set(p.company_id, {
      pareto_class: normalizePareto(p.pareto_class),
      customer_status: p.customer_status,
    });
  }

  const ltvMap = new Map<number, number | null>();
  for (const l of (ltv.data ?? []) as Array<{
    company_id: number;
    churn_risk_score: number | null;
  }>) {
    ltvMap.set(l.company_id, l.churn_risk_score);
  }

  return baseRows.map((r) => ({
    ...r,
    pareto_class: paretoMap.get(r.company_id)?.pareto_class ?? null,
    customer_status: paretoMap.get(r.company_id)?.customer_status ?? null,
    churn_risk_score: ltvMap.get(r.company_id) ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// COMPANY 360 detail
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
  // Narrative extras
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
  // Comms
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
}

export async function getCompanyDetail(
  id: number
): Promise<CompanyDetail | null> {
  const sb = getServiceClient();

  const [base, profile, narrative, ltv] = await Promise.all([
    sb
      .from("companies")
      .select(
        "id, name, canonical_name, rfc, industry, city, country, is_customer, is_supplier, credit_limit, payment_term"
      )
      .eq("id", id)
      .maybeSingle(),
    sb.from("company_profile").select("*").eq("company_id", id).maybeSingle(),
    sb
      .from("company_narrative")
      .select("*")
      .eq("company_id", id)
      .maybeSingle(),
    sb
      .from("customer_ltv_health")
      .select("ltv_mxn, revenue_12m, revenue_3m, churn_risk_score, overdue_risk_score")
      .eq("company_id", id)
      .maybeSingle(),
  ]);

  if (!base.data) return null;

  const b = base.data as {
    id: number;
    name: string;
    canonical_name: string | null;
    rfc: string | null;
    industry: string | null;
    city: string | null;
    country: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
    credit_limit: number | null;
    payment_term: string | null;
  };
  const p = (profile.data ?? {}) as Partial<{
    total_revenue: number;
    revenue_90d: number;
    trend_pct: number;
    total_orders: number;
    last_order_date: string;
    pending_amount: number;
    overdue_amount: number;
    max_days_overdue: number;
    overdue_count: number;
    total_deliveries: number;
    late_deliveries: number;
    otd_rate: number;
    email_count: number;
    last_email_date: string;
    tier: string;
    risk_level: string;
  }>;
  const n = (narrative.data ?? {}) as Partial<{
    monthly_avg: number;
    days_since_last_order: number;
    emails_30d: number;
    complaints: number;
    commitments: number;
    requests: number;
    recent_complaints: string;
    salespeople: string;
    top_products: string;
    tier: string;
    risk_level: string;
  }>;
  const l = (ltv.data ?? {}) as Partial<{
    ltv_mxn: number;
    revenue_12m: number;
    revenue_3m: number;
    churn_risk_score: number;
    overdue_risk_score: number;
  }>;

  return {
    id: b.id,
    name: b.name,
    canonicalName: b.canonical_name,
    rfc: b.rfc,
    industry: b.industry,
    city: b.city,
    country: b.country,
    isCustomer: !!b.is_customer,
    isSupplier: !!b.is_supplier,
    creditLimit: b.credit_limit,
    paymentTerm: b.payment_term,
    tier: p.tier ?? n.tier ?? null,
    riskLevel: p.risk_level ?? n.risk_level ?? null,
    totalRevenue: Number(p.total_revenue) || 0,
    revenue90d: Number(p.revenue_90d) || 0,
    revenue12m: Number(l.revenue_12m) || 0,
    revenue3m: Number(l.revenue_3m) || 0,
    trendPct: Number(p.trend_pct) || 0,
    monthlyAvg: Number(n.monthly_avg) || 0,
    totalOrders: Number(p.total_orders) || 0,
    lastOrderDate: p.last_order_date ?? null,
    daysSinceLastOrder: Number(n.days_since_last_order) || null,
    pendingAmount: Number(p.pending_amount) || 0,
    overdueAmount: Number(p.overdue_amount) || 0,
    maxDaysOverdue: Number(p.max_days_overdue) || null,
    overdueCount: Number(p.overdue_count) || 0,
    totalDeliveries: Number(p.total_deliveries) || 0,
    lateDeliveries: Number(p.late_deliveries) || 0,
    otdRate: Number(p.otd_rate) || null,
    ltvMxn: Number(l.ltv_mxn) || null,
    churnRiskScore: Number(l.churn_risk_score) || null,
    overdueRiskScore: Number(l.overdue_risk_score) || null,
    emailCount: Number(p.email_count) || 0,
    emails30d: Number(n.emails_30d) || 0,
    lastEmailDate: p.last_email_date ?? null,
    complaints: Number(n.complaints) || 0,
    commitments: Number(n.commitments) || 0,
    requests: Number(n.requests) || 0,
    recentComplaints: n.recent_complaints ?? null,
    salespeople: n.salespeople ?? null,
    topProducts: n.top_products ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Recent orders / invoices / deliveries for Company 360
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyOrderRow {
  id: number;
  name: string | null;
  date_order: string | null;
  amount_total_mxn: number | null;
  state: string | null;
  salesperson_name: string | null;
}

export async function getCompanyOrders(
  companyId: number,
  limit = 15
): Promise<CompanyOrderRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_sale_orders")
    .select("id, name, date_order, amount_total_mxn, state, salesperson_name")
    .eq("company_id", companyId)
    .order("date_order", { ascending: false })
    .limit(limit);
  return (data ?? []) as CompanyOrderRow[];
}

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

export async function getCompanyInvoices(
  companyId: number,
  limit = 20
): Promise<CompanyInvoiceRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_invoices")
    .select(
      "id, name, invoice_date, due_date, amount_total_mxn, amount_residual_mxn, currency, payment_state, days_overdue"
    )
    .eq("company_id", companyId)
    .eq("move_type", "out_invoice")
    .order("invoice_date", { ascending: false })
    .limit(limit);
  return (data ?? []) as CompanyInvoiceRow[];
}

export interface CompanyDeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  scheduled_date: string | null;
  date_done: string | null;
  state: string | null;
  is_late: boolean | null;
}

export async function getCompanyDeliveries(
  companyId: number,
  limit = 15
): Promise<CompanyDeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_deliveries")
    .select(
      "id, name, picking_type_code, scheduled_date, date_done, state, is_late"
    )
    .eq("company_id", companyId)
    .order("scheduled_date", { ascending: false })
    .limit(limit);
  return (data ?? []) as CompanyDeliveryRow[];
}

export interface CompanyProductRow {
  product_ref: string | null;
  product_name: string | null;
  total_qty: number;
  total_revenue: number;
  last_order_date: string | null;
}

/**
 * Top productos comprados por esta empresa (agregado desde odoo_order_lines
 * usando `subtotal_mxn` per spec).
 */
export async function getCompanyTopProducts(
  companyId: number,
  limit = 10
): Promise<CompanyProductRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_order_lines")
    .select("product_ref, product_name, qty, subtotal_mxn, order_date")
    .eq("company_id", companyId)
    .eq("order_type", "sale");
  const rows = (data ?? []) as Array<{
    product_ref: string | null;
    product_name: string | null;
    qty: number | null;
    subtotal_mxn: number | null;
    order_date: string | null;
  }>;
  const byProduct = new Map<string, CompanyProductRow>();
  for (const r of rows) {
    const key = r.product_ref ?? r.product_name ?? "—";
    const entry =
      byProduct.get(key) ??
      ({
        product_ref: r.product_ref,
        product_name: r.product_name,
        total_qty: 0,
        total_revenue: 0,
        last_order_date: null,
      } satisfies CompanyProductRow);
    entry.total_qty += Number(r.qty) || 0;
    entry.total_revenue += Number(r.subtotal_mxn) || 0;
    if (
      r.order_date &&
      (!entry.last_order_date || r.order_date > entry.last_order_date)
    ) {
      entry.last_order_date = r.order_date;
    }
    byProduct.set(key, entry);
  }
  return [...byProduct.values()]
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, limit);
}

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
  limit = 10
): Promise<CompanyActivityRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_activities")
    .select("id, activity_type, summary, date_deadline, assigned_to, is_overdue")
    .eq("company_id", companyId)
    .order("date_deadline", { ascending: true })
    .limit(limit);
  return (data ?? []) as CompanyActivityRow[];
}
