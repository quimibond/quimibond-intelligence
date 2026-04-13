import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Dashboard queries — todo ejecutado en Server Components.
 * SIEMPRE usa campos _mxn para sumas.
 */

export interface DashboardKpis {
  revenueMonth: number;
  revenuePrevMonth: number;
  revenueTrendPct: number;
  cashPositionMxn: number;
  overdueTotalMxn: number;
  overdueInvoiceCount: number;
  insightsNew: number;
  insightsCritical: number;
  otdPct: number | null;
  topAtRiskClients: Array<{
    company_id: number | string | null;
    company_name: string | null;
    tier: string | null;
    ltv_mxn: number | null;
    churn_risk_score: number | null;
    overdue_risk_score: number | null;
    max_days_overdue: number | null;
  }>;
  lastUpdated: string;
}

function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

async function sumInvoices(
  params: {
    move_type: "out_invoice" | "in_invoice";
    from: string;
    to?: string;
  }
): Promise<number> {
  const sb = getServiceClient();
  let query = sb
    .from("odoo_invoices")
    .select("amount_total_mxn")
    .eq("move_type", params.move_type)
    .neq("state", "cancel")
    .gte("invoice_date", params.from);
  if (params.to) query = query.lt("invoice_date", params.to);
  const { data } = await query;
  return (data ?? []).reduce(
    (acc: number, row: { amount_total_mxn: number | null }) =>
      acc + (Number(row.amount_total_mxn) || 0),
    0
  );
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const sb = getServiceClient();

  const now = new Date();
  const thisMonthStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextMonthStart = monthStart(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const prevMonthStart = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [
    revenueMonth,
    revenuePrev,
    cash,
    overdueAgg,
    insightsNew,
    insightsCritical,
    otd,
    ltv,
  ] = await Promise.all([
    sumInvoices({ move_type: "out_invoice", from: thisMonthStart, to: nextMonthStart }),
    sumInvoices({ move_type: "out_invoice", from: prevMonthStart, to: thisMonthStart }),
    sb
      .from("odoo_bank_balances")
      .select("current_balance")
      .eq("currency", "MXN"),
    sb
      .from("odoo_invoices")
      .select("amount_residual_mxn,days_overdue")
      .eq("move_type", "out_invoice")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("state", "new"),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("state", "new")
      .eq("severity", "critical"),
    sb
      .from("ops_delivery_health_weekly")
      .select("otd_pct,week")
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("customer_ltv_health")
      .select(
        "company_id, company_name, tier, ltv_mxn, churn_risk_score, overdue_risk_score, max_days_overdue"
      )
      .gt("churn_risk_score", 60)
      .order("churn_risk_score", { ascending: false })
      .limit(5),
  ]);

  const cashTotal = (cash.data ?? []).reduce(
    (acc: number, row: { current_balance: number | null }) =>
      acc + (Number(row.current_balance) || 0),
    0
  );

  const overdueRows = (overdueAgg.data ?? []) as Array<{
    amount_residual_mxn: number | null;
  }>;
  const overdueTotal = overdueRows.reduce(
    (acc, row) => acc + (Number(row.amount_residual_mxn) || 0),
    0
  );

  const trend =
    revenuePrev > 0 ? ((revenueMonth - revenuePrev) / revenuePrev) * 100 : 0;

  return {
    revenueMonth,
    revenuePrevMonth: revenuePrev,
    revenueTrendPct: trend,
    cashPositionMxn: cashTotal,
    overdueTotalMxn: overdueTotal,
    overdueInvoiceCount: overdueRows.length,
    insightsNew: insightsNew.count ?? 0,
    insightsCritical: insightsCritical.count ?? 0,
    otdPct: (otd.data as { otd_pct: number | null } | null)?.otd_pct ?? null,
    topAtRiskClients: (ltv.data ?? []) as DashboardKpis["topAtRiskClients"],
    lastUpdated: new Date().toISOString(),
  };
}

export interface MonthlyRevenuePoint {
  period: string;
  revenue: number;
}

export async function getRevenueTrend(
  months = 12
): Promise<MonthlyRevenuePoint[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = monthStart(since);

  const { data } = await sb
    .from("odoo_invoices")
    .select("invoice_date, amount_total_mxn")
    .eq("move_type", "out_invoice")
    .neq("state", "cancel")
    .gte("invoice_date", sinceStr)
    .order("invoice_date", { ascending: true });

  const buckets = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    invoice_date: string | null;
    amount_total_mxn: number | null;
  }>) {
    if (!row.invoice_date) continue;
    const key = row.invoice_date.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + (Number(row.amount_total_mxn) || 0));
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, revenue]) => ({ period, revenue }));
}
