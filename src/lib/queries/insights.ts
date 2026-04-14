import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export type InsightState =
  | "new"
  | "seen"
  | "acted_on"
  | "dismissed"
  | "expired"
  | "archived";

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
  agent_slug: string | null;
  agent_name: string | null;
  business_impact_estimate: number | null;
  confidence: number | null;
  recommendation: string | null;
}

/**
 * Lista de insights con join a companies (FK) y ai_agents (FK).
 * Usa nombres reales: description (no summary), assignee_name, agent_id.
 */
export async function getInsights(params?: {
  state?: InsightState | InsightState[];
  severity?: string | string[];
  limit?: number;
}): Promise<InsightRow[]> {
  const sb = getServiceClient();
  let query = sb
    .from("agent_insights")
    .select(
      "id, title, description, severity, state, category, company_id, created_at, assignee_name, assignee_email, agent_id, business_impact_estimate, confidence, recommendation, companies:company_id(name), ai_agents:agent_id(slug, name)"
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

  if (params?.severity) {
    if (Array.isArray(params.severity)) {
      query = query.in("severity", params.severity);
    } else {
      query = query.eq("severity", params.severity);
    }
  }

  const { data } = await query;
  type Raw = Omit<
    InsightRow,
    "company_name" | "agent_slug" | "agent_name"
  > & { companies: unknown; ai_agents: unknown };

  return ((data ?? []) as unknown as Raw[]).map((row) => {
    const ag = Array.isArray(row.ai_agents)
      ? (row.ai_agents[0] as { slug?: string; name?: string } | undefined)
      : (row.ai_agents as { slug?: string; name?: string } | null);
    return {
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
      agent_slug: ag?.slug ?? null,
      agent_name: ag?.name ?? null,
      business_impact_estimate: row.business_impact_estimate,
      confidence: row.confidence,
      recommendation: row.recommendation,
    };
  });
}

export interface InsightDetail extends InsightRow {
  evidence: unknown;
  contact_id: number | null;
  user_feedback: string | null;
  was_useful: boolean | null;
  expires_at: string | null;
  assignee_department: string | null;
}

export async function getInsightById(
  id: number
): Promise<InsightDetail | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_insights")
    .select(
      "id, title, description, severity, state, category, company_id, contact_id, created_at, assignee_name, assignee_email, assignee_department, agent_id, business_impact_estimate, confidence, recommendation, evidence, user_feedback, was_useful, expires_at, companies:company_id(name), ai_agents:agent_id(slug, name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as {
    id: number;
    title: string | null;
    description: string | null;
    severity: string | null;
    state: string | null;
    category: string | null;
    company_id: number | null;
    contact_id: number | null;
    created_at: string | null;
    assignee_name: string | null;
    assignee_email: string | null;
    assignee_department: string | null;
    agent_id: number | null;
    business_impact_estimate: number | null;
    confidence: number | null;
    recommendation: string | null;
    evidence: unknown;
    user_feedback: string | null;
    was_useful: boolean | null;
    expires_at: string | null;
    companies: unknown;
    ai_agents: unknown;
  };

  const ag = Array.isArray(row.ai_agents)
    ? (row.ai_agents[0] as { slug?: string; name?: string } | undefined)
    : (row.ai_agents as { slug?: string; name?: string } | null);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    state: row.state,
    category: row.category,
    company_id: row.company_id,
    contact_id: row.contact_id,
    company_name: joinedCompanyName(row.companies),
    created_at: row.created_at,
    assignee_name: row.assignee_name,
    assignee_email: row.assignee_email,
    assignee_department: row.assignee_department,
    agent_id: row.agent_id,
    agent_slug: ag?.slug ?? null,
    agent_name: ag?.name ?? null,
    business_impact_estimate: row.business_impact_estimate,
    confidence: row.confidence,
    recommendation: row.recommendation,
    evidence: row.evidence,
    user_feedback: row.user_feedback,
    was_useful: row.was_useful,
    expires_at: row.expires_at,
  };
}

export async function getInsightCounts(): Promise<{
  new: number;
  seen: number;
  acted_on: number;
  dismissed: number;
  total: number;
  critical: number;
  high: number;
}> {
  const sb = getServiceClient();
  const [totalNew, totalSeen, totalActed, totalDismissed, critical, high] =
    await Promise.all([
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "new"),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "seen"),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "acted_on"),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "dismissed"),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .in("state", ["new", "seen"])
        .eq("severity", "critical"),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .in("state", ["new", "seen"])
        .eq("severity", "high"),
    ]);
  return {
    new: totalNew.count ?? 0,
    seen: totalSeen.count ?? 0,
    acted_on: totalActed.count ?? 0,
    dismissed: totalDismissed.count ?? 0,
    total:
      (totalNew.count ?? 0) +
      (totalSeen.count ?? 0) +
      (totalActed.count ?? 0) +
      (totalDismissed.count ?? 0),
    critical: critical.count ?? 0,
    high: high.count ?? 0,
  };
}
