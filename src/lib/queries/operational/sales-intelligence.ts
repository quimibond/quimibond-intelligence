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

/** A single concrete next-step parsed out of agent_insights.recommendation. */
export interface SalesNextStep {
  /** Person responsible — extracted from "Persona: acción" prefix. May be null
   *  when the LLM didn't follow the convention. */
  owner: string | null;
  /** The action sentence itself, sans the owner prefix. */
  text: string;
}

export interface SalesAction {
  id: number;
  title: string;
  /** Long-form explanation of WHY this matters. Often missing for older
   *  insights — caller should fall back to title. */
  description: string | null;
  severity: SalesActionSeverity;
  impactMxn: number | null;
  /** 0–1. Surfaces "how confident the agent is" so the CEO can calibrate. */
  confidence: number | null;
  /** Parsed list of next steps. recommendation.split("|") + owner extraction. */
  nextSteps: SalesNextStep[];
  /** Verifiable facts the agent used (entries from agent_insights.evidence). */
  evidence: string[];
  /** The agent that produced the insight (for provenance). */
  agentName: string | null;
  companyId: number | null;
  companyName: string | null;
  /** Internal routing assignee (often the area lead or CEO via insight_routing
   *  trigger). Different from `nextSteps[].owner`, which is the actual person
   *  named in the LLM-generated action text. */
  routedTo: string | null;
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
 * Split agent_insights.recommendation into discrete next steps.
 *
 * Convention emitted by the Director Comercial agent:
 *
 *   "Owner Name: Acción concreta | Owner Name: Otra acción | ..."
 *
 * Owners aren't always present (legacy / different agents). When the prefix
 * is missing we surface the whole text as a single step with owner=null.
 */
function parseNextSteps(recommendation: string | null): SalesNextStep[] {
  if (!recommendation) return [];
  const parts = recommendation
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => {
    // Match "Owner: action". Owner = up to first colon, but reject if the
    // prefix has more than 6 words (that's a sentence, not a name).
    // [\s\S]+ instead of .+ with /s flag — tsconfig target=ES2017 lacks dotAll.
    const m = /^([^:]{1,80}):\s*([\s\S]+)$/.exec(p);
    if (m) {
      const owner = m[1].trim();
      if (owner.split(/\s+/).length <= 6) {
        return { owner, text: m[2].trim() };
      }
    }
    return { owner: null, text: p };
  });
}

function parseEvidence(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object"
            ? JSON.stringify(item)
            : String(item)
      )
      .filter(Boolean);
  }
  if (typeof raw === "string") return [raw];
  return [];
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
      "id, title, description, severity, business_impact_estimate, recommendation, evidence, confidence, company_id, assignee_name, created_at, companies:company_id(name), ai_agents:agent_id(slug, name)"
    )
    .eq("category", "ventas")
    .in("state", ["new", "seen"])
    .order("business_impact_estimate", { ascending: false, nullsFirst: false })
    .limit(50);

  type Raw = {
    id: number;
    title: string | null;
    description: string | null;
    severity: string | null;
    business_impact_estimate: number | null;
    recommendation: string | null;
    evidence: unknown;
    confidence: number | null;
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
      description: row.description,
      severity: normalizeSeverity(row.severity),
      impactMxn:
        row.business_impact_estimate != null
          ? Number(row.business_impact_estimate)
          : null,
      confidence:
        row.confidence != null ? Number(row.confidence) : null,
      nextSteps: parseNextSteps(row.recommendation),
      evidence: parseEvidence(row.evidence),
      agentName: ag?.name ?? null,
      companyId: row.company_id,
      companyName: joinedCompanyName(row.companies),
      routedTo: row.assignee_name,
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
 *
 * 2026-04-25: client_reorder_predictions.total_revenue is NULL for every
 * row in the current MV (pipeline regression — TODO Silver SP6.x). We
 * derive a lifetime revenue proxy = order_count × avg_order_value so the
 * banner and ranking still have meaningful numbers.
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

function lifetimeRevenueProxy(r: {
  total_revenue: number | null;
  order_count: number | null;
  avg_order_value: number | null;
}): number {
  if (r.total_revenue != null && r.total_revenue > 0) return r.total_revenue;
  const oc = r.order_count ?? 0;
  const aov = r.avg_order_value ?? 0;
  return oc > 0 && aov > 0 ? oc * aov : 0;
}

export async function getReorderRiskSummary(): Promise<ReorderRiskSummary> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, reorder_status, days_overdue_reorder, total_revenue, order_count, avg_order_value, salesperson_name"
    )
    .in("reorder_status", ["overdue", "at_risk", "critical"])
    .limit(500);

  type Raw = {
    company_id: number;
    company_name: string | null;
    reorder_status: string;
    days_overdue_reorder: number | null;
    total_revenue: number | null;
    order_count: number | null;
    avg_order_value: number | null;
    salesperson_name: string | null;
  };
  const rows = (data ?? []) as Raw[];
  const enriched = rows.map((r) => ({
    ...r,
    revenue_proxy: lifetimeRevenueProxy(r),
  }));
  const critical = enriched
    .filter((r) => r.reorder_status === "critical")
    .sort((a, b) => b.revenue_proxy - a.revenue_proxy);

  return {
    criticalCount: critical.length,
    totalAtRiskCount: rows.length,
    totalRevenueAtRisk: enriched.reduce((s, r) => s + r.revenue_proxy, 0),
    topCritical: critical.slice(0, 3).map((r) => ({
      company_id: r.company_id,
      company_name: r.company_name,
      days_overdue_reorder: r.days_overdue_reorder,
      total_revenue: r.revenue_proxy > 0 ? r.revenue_proxy : null,
      salesperson_name: r.salesperson_name,
    })),
  };
}
