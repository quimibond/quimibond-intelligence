import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export interface InsightRow {
  id: number;
  title: string | null;
  description: string | null;
  severity: string | null;
  state: string | null;
  category: string | null;
  company_id: number | null;
  company_name: string | null;
  created_at: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  agent_id: number | null;
  business_impact_estimate: number | null;
  confidence: number | null;
  recommendation: string | null;
}

/**
 * Fetch insights con join a companies (FK declarada).
 * Usa los nombres reales: description (no summary), assignee_name (no assignee),
 * agent_id (no agent_slug).
 */
export async function getInsights(params?: {
  state?: string | string[];
  severity?: string;
  limit?: number;
}): Promise<InsightRow[]> {
  const sb = getServiceClient();
  let query = sb
    .from("agent_insights")
    .select(
      "id, title, description, severity, state, category, company_id, created_at, assignee_name, assignee_email, agent_id, business_impact_estimate, confidence, recommendation, companies:company_id(name)"
    )
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 100);

  if (params?.state) {
    if (Array.isArray(params.state)) {
      query = query.in("state", params.state);
    } else {
      query = query.eq("state", params.state);
    }
  } else {
    query = query.in("state", ["new", "seen"]);
  }

  if (params?.severity) query = query.eq("severity", params.severity);

  const { data } = await query;
  type Raw = Omit<InsightRow, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    state: row.state,
    category: row.category,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    created_at: row.created_at,
    assignee_name: row.assignee_name,
    assignee_email: row.assignee_email,
    agent_id: row.agent_id,
    business_impact_estimate: row.business_impact_estimate,
    confidence: row.confidence,
    recommendation: row.recommendation,
  }));
}

/**
 * Conteo rápido para el badge de "insights nuevos" en el dashboard.
 */
export async function getNewInsightsCounts(): Promise<{
  total: number;
  critical: number;
  high: number;
}> {
  const sb = getServiceClient();
  const [total, critical, high] = await Promise.all([
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
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("state", "new")
      .eq("severity", "high"),
  ]);
  return {
    total: total.count ?? 0,
    critical: critical.count ?? 0,
    high: high.count ?? 0,
  };
}
