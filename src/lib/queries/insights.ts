import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

/** Slugs de agentes legacy/sistema cuyos insights NO deben llegar al CEO.
 *  Se usan SOLO cuando `excludeLegacy=true` (default) — la página
 *  `/agents/[slug]` los habilita explícitamente para poder mostrar los
 *  insights de data_quality/meta/cleanup/odoo al CEO cuando navega a
 *  la ficha del agente. */
const LEGACY_AGENT_SLUGS = new Set(["data_quality", "meta", "cleanup", "odoo"]);

/**
 * Filtro SQL (PostgREST .or()) que replica `isVisibleToCEO`.
 * Cobranza insights se ocultan EXCEPTO si severity=critical o
 * business_impact_estimate >= 500K. Cualquier otra categoría pasa.
 *
 *   (category != 'cobranza') OR (severity = 'critical') OR (impact >= 500K)
 *
 * Exportado para que getContactsKpis/getContactDetail/equipo apliquen
 * la misma regla del lado SQL.
 */
export const CEO_VISIBLE_FILTER =
  "category.neq.cobranza,severity.eq.critical,business_impact_estimate.gte.500000";

/**
 * CEO inbox filter (audit 2026-04-15 sprint 2).
 *
 * Categoria `cobranza` tenia 91 insights en 30d con 2.2% de tasa de accion
 * del CEO (vs 22% para ventas/proveedores). La razon no es que los insights
 * esten mal — es que cobranza no es chamba del CEO, es de Sandra Davila, y
 * el routing ya la asigna a ella via trigger. El CEO solo necesita verlo
 * cuando el monto es estrategicamente grande o la urgencia es maxima.
 *
 * Regla: ocultar insights de cobranza del inbox del CEO EXCEPTO cuando
 *  - severity = 'critical'  (urgencia maxima declarada por el director)
 *  - business_impact_estimate >= 500,000 MXN  (cartera estrategica)
 *
 * Sandra sigue viendo todos los de cobranza en su propia vista.
 */
export function isVisibleToCEO(insight: {
  category: string | null;
  severity: string | null;
  business_impact_estimate: number | null;
}): boolean {
  if (insight.category !== "cobranza") return true;
  if (insight.severity === "critical") return true;
  const impact = Number(insight.business_impact_estimate ?? 0);
  if (Number.isFinite(impact) && impact >= 500_000) return true;
  return false;
}

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
 *
 *  - `agentId`: si se pasa, aplica `.eq('agent_id', id)` EN LA QUERY (no
 *    post-filter). Evita la trampa de limit-antes-de-filter cuando la
 *    página `/agents/[slug]` pedía 30 globales y descartaba 81-96% de
 *    los insights tras filtrar por agente.
 *  - `excludeLegacy`: default `true`. La página `/agents/[slug]` lo pone
 *    a `false` para poder mostrar insights de data_quality/meta/cleanup/
 *    odoo cuando el CEO abre la ficha del agente.
 */
export async function getInsights(params?: {
  state?: InsightState | InsightState[];
  severity?: string | string[];
  limit?: number;
  agentId?: number;
  excludeLegacy?: boolean;
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

  if (params?.agentId != null) {
    query = query.eq("agent_id", params.agentId);
  }

  const { data } = await query;
  type Raw = Omit<
    InsightRow,
    "company_name" | "agent_slug" | "agent_name"
  > & { companies: unknown; ai_agents: unknown };

  const excludeLegacy = params?.excludeLegacy ?? true;

  return ((data ?? []) as unknown as Raw[])
    .map((row) => {
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
    })
    .filter(
      (row) =>
        !excludeLegacy || !row.agent_slug || !LEGACY_AGENT_SLUGS.has(row.agent_slug),
    );
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

/**
 * Conteos por estado/severidad del `/inbox`. Aplica CEO_VISIBLE_FILTER
 * para que los badges "X critical" coincidan exactamente con lo que
 * la lista renderiza (antes podían diferir por cobranza oculta).
 */
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
        .eq("state", "new")
        .or(CEO_VISIBLE_FILTER),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "seen")
        .or(CEO_VISIBLE_FILTER),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "acted_on")
        .or(CEO_VISIBLE_FILTER),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("state", "dismissed")
        .or(CEO_VISIBLE_FILTER),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .in("state", ["new", "seen"])
        .eq("severity", "critical")
        .or(CEO_VISIBLE_FILTER),
      sb
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .in("state", ["new", "seen"])
        .eq("severity", "high")
        .or(CEO_VISIBLE_FILTER),
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
