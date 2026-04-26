import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * dashboard.ts — Dashboard queries.
 *
 * Legacy: getDashboardKpis() calls get_dashboard_kpis() RPC.
 *   SP5-VERIFIED: get_dashboard_kpis() RPC is live and consumed by page.tsx —
 *   retained as the authoritative composite KPI source until page.tsx is rewired to gold views.
 *
 * Gold layer: fetchDashboardKpis() reads:
 * - gold_reconciliation_health
 * - gold_cashflow
 * - gold_revenue_monthly (canonical_company_id IS NULL = grand total)
 * - gold_ceo_inbox
 *
 * Deprecated sources removed from this file:
 * - customer_ltv_health MV  (dropped SP1) → replaced by gold_company_360
 * - pl_estado_resultados    (dropped SP1) → replaced by gold_revenue_monthly
 */

// ──────────────────────────────────────────────────────────────────────────
// Legacy DashboardKpis — shape returned by get_dashboard_kpis() RPC
// ──────────────────────────────────────────────────────────────────────────

export interface DashboardKpis {
  revenue: {
    this_month: number;
    last_month: number;
    ytd: number;
  };
  collections: {
    total_overdue_mxn: number;
    overdue_count: number;
    expected_collections_30d: number;
    clients_at_risk: number;
  };
  cash: {
    cash_mxn: number;
    cash_usd: number;
    total_mxn: number;
    runway_days: number;
  };
  insights: {
    new_count: number;
    urgent_count: number;
    acted_this_month: number;
    acceptance_rate: number;
  };
  predictions: {
    reorders_overdue: number;
    reorders_lost: number;
    reorders_at_risk_mxn: number;
    payments_at_risk: number;
    payments_improving: number;
  };
  operations: {
    otd_rate: number | null;
    pending_deliveries: number;
    late_deliveries: number;
    manufacturing_active: number;
    overdue_activities: number;
  };
  generated_at: string;
}

/**
 * getDashboardKpis — legacy RPC-based composite KPI fetch.
 * SP5-VERIFIED: get_dashboard_kpis() RPC is live and still consumed by page.tsx.
 * Retained until page.tsx is migrated to gold views.
 */
export async function getDashboardKpis(): Promise<DashboardKpis | null> {
  const sb = getServiceClient();
  // SP5-VERIFIED: get_dashboard_kpis() RPC is live and authoritative for CEO dashboard KPIs
  const { data, error } = await sb.rpc("get_dashboard_kpis");
  if (error) {
    console.error("[get_dashboard_kpis]", error.message);
    return null;
  }
  if (!data) return null;
  const kpis = data as DashboardKpis;

  // Fill reorders_at_risk_mxn from client_reorder_predictions when the RPC
  // omits it (current behaviour — RPC returns null because total_revenue
  // column is not populated). Sum avg_order_value across rows whose
  // status is overdue or at_risk; gives a directionally-correct $ figure
  // tied to the same `predictions.reorders_overdue` count shown in the
  // KpiCard subtitle.
  if (kpis.predictions.reorders_at_risk_mxn == null) {
    const { data: predRows } = await sb
      .from("client_reorder_predictions")
      .select("reorder_status, avg_order_value")
      .in("reorder_status", ["overdue", "at_risk"])
      .limit(2000);
    const sum = ((predRows ?? []) as Array<{
      reorder_status: string | null;
      avg_order_value: number | null;
    }>).reduce((s, r) => s + (Number(r.avg_order_value) || 0), 0);
    if (sum > 0) {
      kpis.predictions = { ...kpis.predictions, reorders_at_risk_mxn: sum };
    }
  }
  return kpis;
}

// ──────────────────────────────────────────────────────────────────────────
// Gold layer — fetchDashboardKpis (new, reads gold views directly)
// ──────────────────────────────────────────────────────────────────────────

export interface MonthlyRevenuePoint {
  period: string;
  revenue: number;
}

export async function fetchDashboardKpis() {
  const sb = getServiceClient();
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1)
    .toISOString()
    .slice(0, 10);

  const [recHealth, cash, revenueYtd] = await Promise.all([
    sb.from("gold_reconciliation_health").select("*").maybeSingle(),
    sb.from("gold_cashflow").select("*").maybeSingle(),
    sb
      .from("gold_revenue_monthly")
      .select("month_start, resolved_mxn, odoo_mxn, sat_mxn")
      .is("canonical_company_id", null)
      .gte("month_start", ytdFrom)
      .order("month_start"),
  ]);

  return {
    reconciliation: recHealth.data ?? null,
    cashflow: cash.data ?? null,
    revenueYtd: revenueYtd.data ?? [],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Dashboard Alerts (gold_ceo_inbox)
// ──────────────────────────────────────────────────────────────────────────

export interface CeoInboxRow {
  issue_id: string;
  description: string | null;
  severity: string | null;
  priority_score: number | null;
  impact_mxn: number | null;
}

export async function fetchDashboardAlerts(limit = 5): Promise<CeoInboxRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("gold_ceo_inbox")
    .select("issue_id, description, severity, priority_score, impact_mxn")
    .order("priority_score", { ascending: false })
    .limit(limit);
  return (data ?? []) as CeoInboxRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// Revenue trend sparkline — last N months from gold_pl_statement.
//
// Original implementation read gold_revenue_monthly with
// canonical_company_id IS NULL (grand-total rows), but those rows are
// almost never populated (live DB has just 1 row from 2025-03 / $76k).
// gold_pl_statement is the canonical monthly P&L source — same view that
// /finanzas hero reads — and stores total_income negative (credit side),
// so abs() = revenue.
// ──────────────────────────────────────────────────────────────────────────

export async function getRevenueTrend(
  months = 12
): Promise<MonthlyRevenuePoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("gold_pl_statement")
    .select("period, total_income")
    .order("period", { ascending: false })
    .limit(months + 5);

  return ((data ?? []) as Array<{
    period: string | null;
    total_income: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const year = Number(r.period.split("-")[0]);
      return year >= 2020 && year <= 2030;
    })
    .slice(0, months)
    .map((r) => ({
      // gold_pl_statement.period is "YYYY-MM"; chart expects ISO-like
      // month_start so we suffix "-01" for downstream date parsing.
      period: `${r.period}-01`,
      revenue: Math.abs(Number(r.total_income) || 0),
    }))
    .reverse();
}

// ──────────────────────────────────────────────────────────────────────────
// At-risk clients — reads gold_company_360 (was customer_ltv_health MV, dropped SP1)
// ──────────────────────────────────────────────────────────────────────────

export interface AtRiskClient {
  canonical_company_id: number;
  display_name: string | null;
  tier: string | null;
  lifetime_value_mxn: number | null;
  overdue_amount_mxn: number | null;
  max_days_overdue: number | null;
  blacklist_level: string | null;
  // Back-compat aliases for page.tsx consumers
  company_id: number;
  company_name: string | null;
  ltv_mxn: number | null;
  churn_risk_score: number | null;
}

export async function getTopAtRiskClients(limit = 5): Promise<AtRiskClient[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, tier, lifetime_value_mxn, overdue_amount_mxn, max_days_overdue, blacklist_level"
    )
    .eq("is_customer", true)
    .eq("is_internal", false)
    .gt("overdue_amount_mxn", 0)
    .order("overdue_amount_mxn", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<{
    canonical_company_id: number;
    display_name: string | null;
    tier: string | null;
    lifetime_value_mxn: number | null;
    overdue_amount_mxn: number | null;
    max_days_overdue: number | null;
    blacklist_level: string | null;
  }>).map((r) => ({
    ...r,
    // Back-compat aliases for consumers that use old customer_ltv_health field names
    company_id: r.canonical_company_id,
    company_name: r.display_name,
    ltv_mxn: r.lifetime_value_mxn,
    churn_risk_score: null, // gold_company_360 has no churn_risk_score — use overdue_amount_mxn as proxy
  }));
}
