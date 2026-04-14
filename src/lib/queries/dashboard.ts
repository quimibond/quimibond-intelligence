import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "./_helpers";

/**
 * Dashboard queries v3 — UNA sola llamada a `get_dashboard_kpis()` RPC.
 * Todas las cifras vienen normalizadas a MXN desde el backend.
 *
 * Shape 1:1 con el JSONB del RPC.
 */

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
 * Fetches all CEO dashboard KPIs in a single RPC call.
 * Canonical source — never compose KPIs from raw tables.
 */
export async function getDashboardKpis(): Promise<DashboardKpis | null> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_dashboard_kpis");
  if (error) {
    console.error("[get_dashboard_kpis]", error.message);
    return null;
  }
  if (!data) return null;
  return data as DashboardKpis;
}

// Top at-risk clients (churn-ranked) — used in dashboard sidebar panel
export interface AtRiskClient {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  ltv_mxn: number | null;
  churn_risk_score: number | null;
  max_days_overdue: number | null;
}

export async function getTopAtRiskClients(limit = 5): Promise<AtRiskClient[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("customer_ltv_health")
    .select(
      "company_id, company_name, tier, ltv_mxn, churn_risk_score, max_days_overdue"
    )
    .gt("churn_risk_score", 70)
    .gt("ltv_mxn", 100_000)
    .not("company_id", "in", pgInList(selfIds))
    .order("churn_risk_score", { ascending: false })
    .limit(limit);
  return (data ?? []) as AtRiskClient[];
}

// Revenue trend sparkline (last 12 months) — from pl_estado_resultados
export interface MonthlyRevenuePoint {
  period: string;
  revenue: number;
}

export async function getRevenueTrend(
  months = 12
): Promise<MonthlyRevenuePoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pl_estado_resultados")
    .select("period, ingresos")
    .order("period", { ascending: false })
    .limit(months + 5);

  return ((data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const year = Number(r.period.split("-")[0]);
      return year >= 2020 && year <= 2030;
    })
    .slice(0, months)
    .map((r) => ({
      period: r.period as string,
      revenue: Number(r.ingresos) || 0,
    }))
    .reverse();
}
