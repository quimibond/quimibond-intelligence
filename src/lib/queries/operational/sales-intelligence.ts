import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "../_shared/_helpers";

/**
 * SP13.6 (ventas) — recomendaciones del Director Comercial IA.
 *
 * Lee `agent_insights` filtrado por `category='ventas'` con state en (new,
 * seen), ordenado por impacto. Es el equivalente del "Recomendaciones del
 * director financiero" que vive en /finanzas, pero alimentado por el
 * pipeline de directores IA (no por una RPC dedicada como cashflow).
 *
 * El CEO ve, en orden de impacto, qué cuenta llamar y qué hacer.
 */

export type SalesActionSeverity = "critical" | "high" | "medium" | "low";

export interface SalesAction {
  id: number;
  title: string;
  severity: SalesActionSeverity;
  impactMxn: number | null;
  recommendation: string | null;
  agentName: string | null;
  companyId: number | null;
  companyName: string | null;
  assigneeName: string | null;
  createdAt: string | null;
}

export interface SalesRecommendations {
  total: number;
  totalImpactMxn: number;
  criticalCount: number;
  highCount: number;
  actions: SalesAction[];
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);

function normalizeSeverity(s: string | null): SalesActionSeverity {
  if (s && VALID_SEVERITIES.has(s)) return s as SalesActionSeverity;
  return "medium";
}

/**
 * Ordered list of open ventas-category insights with company + assignee
 * joined. `limit` controls how many actions we surface — defaults to 6
 * which matches the "top acciones priorizadas" pattern of /finanzas.
 */
export async function getSalesRecommendations(
  limit = 6
): Promise<SalesRecommendations> {
  const sb = getServiceClient();

  // Pull a wider window than `limit` so totals stay accurate when the
  // surfaced top-N is small.
  const { data } = await sb
    .from("agent_insights")
    .select(
      "id, title, severity, business_impact_estimate, recommendation, company_id, assignee_name, created_at, companies:company_id(name), ai_agents:agent_id(slug, name)"
    )
    .eq("category", "ventas")
    .in("state", ["new", "seen"])
    .order("business_impact_estimate", { ascending: false, nullsFirst: false })
    .limit(50);

  type Raw = {
    id: number;
    title: string | null;
    severity: string | null;
    business_impact_estimate: number | null;
    recommendation: string | null;
    company_id: number | null;
    assignee_name: string | null;
    created_at: string | null;
    companies: unknown;
    ai_agents: unknown;
  };

  const rows = ((data ?? []) as unknown as Raw[]).map((row) => {
    const ag = Array.isArray(row.ai_agents)
      ? (row.ai_agents[0] as { slug?: string; name?: string } | undefined)
      : (row.ai_agents as { slug?: string; name?: string } | null);
    const action: SalesAction = {
      id: row.id,
      title: row.title ?? "",
      severity: normalizeSeverity(row.severity),
      impactMxn:
        row.business_impact_estimate != null
          ? Number(row.business_impact_estimate)
          : null,
      recommendation: row.recommendation,
      agentName: ag?.name ?? null,
      companyId: row.company_id,
      companyName: joinedCompanyName(row.companies),
      assigneeName: row.assignee_name,
      createdAt: row.created_at,
    };
    return action;
  });

  const totalImpactMxn = rows.reduce(
    (s, a) => s + (a.impactMxn != null && a.impactMxn > 0 ? a.impactMxn : 0),
    0
  );
  const criticalCount = rows.filter((a) => a.severity === "critical").length;
  const highCount = rows.filter((a) => a.severity === "high").length;

  return {
    total: rows.length,
    totalImpactMxn,
    criticalCount,
    highCount,
    actions: rows.slice(0, limit),
  };
}

/**
 * Compact summary of the reorder-risk pipeline used by the alert banner.
 * Surfaces totals + top-3 critical accounts so we don't have to wait for
 * the full table to render. Reads `client_reorder_predictions` directly
 * (same source the table already uses) to keep one round-trip.
 */
export interface ReorderRiskSummary {
  criticalCount: number;
  totalAtRiskCount: number;
  totalRevenueAtRisk: number;
  topCritical: Array<{
    company_id: number;
    company_name: string | null;
    days_overdue_reorder: number | null;
    total_revenue: number | null;
    salesperson_name: string | null;
  }>;
}

export async function getReorderRiskSummary(): Promise<ReorderRiskSummary> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, reorder_status, days_overdue_reorder, total_revenue, salesperson_name"
    )
    .in("reorder_status", ["overdue", "at_risk", "critical"])
    .order("total_revenue", { ascending: false, nullsFirst: false })
    .limit(500);

  type Raw = {
    company_id: number;
    company_name: string | null;
    reorder_status: string;
    days_overdue_reorder: number | null;
    total_revenue: number | null;
    salesperson_name: string | null;
  };
  const rows = (data ?? []) as Raw[];
  const critical = rows.filter((r) => r.reorder_status === "critical");

  return {
    criticalCount: critical.length,
    totalAtRiskCount: rows.length,
    totalRevenueAtRisk: rows.reduce(
      (s, r) => s + (r.total_revenue ?? 0),
      0
    ),
    topCritical: critical.slice(0, 3).map((r) => ({
      company_id: r.company_id,
      company_name: r.company_name,
      days_overdue_reorder: r.days_overdue_reorder,
      total_revenue: r.total_revenue,
      salesperson_name: r.salesperson_name,
    })),
  };
}
