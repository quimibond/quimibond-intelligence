import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * customer-360.ts — Queries para analytics_customer_360 y vistas fiscales.
 *
 * analytics_customer_360 es la master view por company_id combinando:
 *   Odoo operativo + Syntage fiscal + AI scores (47+ campos).
 */

// ──────────────────────────────────────────────────────────────────────────
// Customer 360 snapshot
// ──────────────────────────────────────────────────────────────────────────

export interface Customer360 {
  company_id: number;
  company_name: string | null;
  rfc: string | null;
  tier: string | null;
  risk_level: string | null;
  // Revenue metrics
  revenue_12m_odoo: number | null;
  revenue_12m_sat: number | null;
  revenue_total_odoo: number | null;
  // Cartera
  overdue_amount: number | null;
  overdue_count: number | null;
  max_days_overdue: number | null;
  // OTD
  otd_rate: number | null;
  late_deliveries: number | null;
  // Fiscal
  fiscal_issues_open: number | null;
  fiscal_issues_critical: number | null;
  cancellation_rate: number | null;
  first_cfdi: string | null;
  last_cfdi: string | null;
  days_since_last_cfdi: number | null;
  fiscal_lifetime_revenue_mxn: number | null;
  // LTV / Churn
  ltv_mxn: number | null;
  churn_risk_score: number | null;
}

export async function getCustomer360(
  companyId: number
): Promise<Customer360 | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("analytics_customer_360")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) return null;

  const r = data as Record<string, unknown>;

  return {
    company_id: Number(r.company_id) || companyId,
    company_name: (r.company_name as string | null) ?? null,
    rfc: (r.rfc as string | null) ?? null,
    tier: (r.tier as string | null) ?? null,
    risk_level: (r.risk_level as string | null) ?? null,
    revenue_12m_odoo: r.revenue_12m_odoo != null ? Number(r.revenue_12m_odoo) : null,
    revenue_12m_sat: r.revenue_12m_sat != null ? Number(r.revenue_12m_sat) : null,
    revenue_total_odoo: r.revenue_total_odoo != null ? Number(r.revenue_total_odoo) : null,
    overdue_amount: r.overdue_amount != null ? Number(r.overdue_amount) : null,
    overdue_count: r.overdue_count != null ? Number(r.overdue_count) : null,
    max_days_overdue: r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    otd_rate: r.otd_rate != null ? Number(r.otd_rate) : null,
    late_deliveries: r.late_deliveries != null ? Number(r.late_deliveries) : null,
    fiscal_issues_open: r.fiscal_issues_open != null ? Number(r.fiscal_issues_open) : null,
    fiscal_issues_critical: r.fiscal_issues_critical != null ? Number(r.fiscal_issues_critical) : null,
    cancellation_rate: r.cancellation_rate != null ? Number(r.cancellation_rate) : null,
    first_cfdi: (r.first_cfdi as string | null) ?? null,
    last_cfdi: (r.last_cfdi as string | null) ?? null,
    days_since_last_cfdi: r.days_since_last_cfdi != null ? Number(r.days_since_last_cfdi) : null,
    fiscal_lifetime_revenue_mxn:
      r.fiscal_lifetime_revenue_mxn != null
        ? Number(r.fiscal_lifetime_revenue_mxn)
        : null,
    ltv_mxn: r.ltv_mxn != null ? Number(r.ltv_mxn) : null,
    churn_risk_score: r.churn_risk_score != null ? Number(r.churn_risk_score) : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Company insights (last N active insights)
// ──────────────────────────────────────────────────────────────────────────

export interface CompanyInsightRow {
  id: number;
  title: string | null;
  description: string | null;
  severity: string | null;
  category: string | null;
  created_at: string | null;
  agent_name: string | null;
}

export async function getCompanyInsights(
  companyId: number,
  limit = 3
): Promise<CompanyInsightRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_insights")
    .select(
      "id, title, description, severity, category, created_at, ai_agents:agent_id(name)"
    )
    .eq("company_id", companyId)
    .in("state", ["new", "seen"])
    .order("created_at", { ascending: false })
    .limit(limit);

  type Raw = Omit<CompanyInsightRow, "agent_name"> & {
    ai_agents: unknown;
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => {
    const ag = Array.isArray(row.ai_agents)
      ? (row.ai_agents[0] as { name?: string } | undefined)
      : (row.ai_agents as { name?: string } | null);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      category: row.category,
      created_at: row.created_at,
      agent_name: ag?.name ?? null,
    };
  });
}
