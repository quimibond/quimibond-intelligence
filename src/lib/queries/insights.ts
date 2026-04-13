import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export interface InsightRow {
  id: string | number;
  title: string | null;
  summary: string | null;
  severity: string | null;
  state: string | null;
  category: string | null;
  company_id: number | string | null;
  company_name: string | null;
  created_at: string | null;
  assignee: string | null;
  agent_slug: string | null;
}

export async function getInsights(params?: {
  state?: string;
  severity?: string;
  limit?: number;
}): Promise<InsightRow[]> {
  const sb = getServiceClient();
  let query = sb
    .from("agent_insights")
    .select(
      "id, title, summary, severity, state, category, company_id, created_at, assignee, agent_slug, companies:company_id(name)"
    )
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 100);

  if (params?.state) query = query.eq("state", params.state);
  else query = query.in("state", ["new", "seen"]);

  if (params?.severity) query = query.eq("severity", params.severity);

  const { data } = await query;
  type Raw = Omit<InsightRow, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    state: row.state,
    category: row.category,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    created_at: row.created_at,
    assignee: row.assignee,
    agent_slug: row.agent_slug,
  }));
}
