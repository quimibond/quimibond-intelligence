import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * System health queries — usa views canónicas:
 * - `claude_cost_summary` — costos de Claude API por endpoint/model
 * - `odoo_sync_freshness` — frescura del sync Odoo→Supabase por tabla
 * - `agent_effectiveness` — métricas de los agentes (acted_rate, etc.)
 * - `data_quality_scorecard` — métricas de calidad de datos
 * - `pipeline_logs` — log de operaciones del pipeline
 * - `notification_queue` — cola de WhatsApp/email pendientes
 * - `agent_runs` — corridas recientes de los agentes
 */

// ──────────────────────────────────────────────────────────────────────────
// Top-level KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface SystemKpis {
  syncStaleCount: number;
  syncTablesTotal: number;
  cost24hUsd: number;
  cost7dUsd: number;
  cost30dUsd: number;
  callsTotal: number;
  qualityIssuesCritical: number;
  qualityIssuesWarning: number;
  pendingNotifications: number;
  failedNotifications: number;
  agentRunsLast24h: number;
  agentRunsErrors24h: number;
}

export async function getSystemKpis(): Promise<SystemKpis> {
  const sb = getServiceClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [sync, cost, quality, notif, runs] = await Promise.all([
    sb.from("odoo_sync_freshness").select("status"), // SP5-EXCEPTION: /sistema diagnostic
    sb.from("claude_cost_summary").select("*"),
    sb.from("data_quality_scorecard").select("severity"),
    sb.from("notification_queue").select("status"), // SP5-EXCEPTION: /sistema diagnostic
    sb
      .from("agent_runs") // SP5-VERIFIED: agent_runs retained (not in §12 drop list)
      .select("status")
      .gte("started_at", since24h),
  ]);

  const syncRows = (sync.data ?? []) as Array<{ status: string | null }>;
  const costRows = (cost.data ?? []) as Array<{
    calls: number | null;
    cost_24h: number | null;
    cost_7d: number | null;
    cost_30d: number | null;
    total_cost_usd: number | null;
  }>;
  const qualityRows = (quality.data ?? []) as Array<{ severity: string | null }>;
  const notifRows = (notif.data ?? []) as Array<{ status: string | null }>;
  const runRows = (runs.data ?? []) as Array<{ status: string | null }>;

  return {
    syncStaleCount: syncRows.filter(
      (r) => r.status === "stale" || r.status === "warning"
    ).length,
    syncTablesTotal: syncRows.length,
    cost24hUsd: costRows.reduce((a, r) => a + (Number(r.cost_24h) || 0), 0),
    cost7dUsd: costRows.reduce((a, r) => a + (Number(r.cost_7d) || 0), 0),
    cost30dUsd: costRows.reduce((a, r) => a + (Number(r.cost_30d) || 0), 0),
    callsTotal: costRows.reduce((a, r) => a + (Number(r.calls) || 0), 0),
    qualityIssuesCritical: qualityRows.filter(
      (r) => r.severity === "critical"
    ).length,
    qualityIssuesWarning: qualityRows.filter((r) => r.severity === "warning")
      .length,
    pendingNotifications: notifRows.filter((r) => r.status === "pending")
      .length,
    failedNotifications: notifRows.filter((r) => r.status === "failed").length,
    agentRunsLast24h: runRows.length,
    agentRunsErrors24h: runRows.filter((r) => r.status === "error").length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Overhead Factor — referencia margen P&L vs margen material CMA
// ──────────────────────────────────────────────────────────────────────────
export interface OverheadFactor {
  totalRevenuePl: number;
  totalCogsPl: number;
  totalGrossProfitPl: number;
  overheadFactorPct: number;  // % de revenue que consume overhead adicional
  realGrossMarginPct: number; // margen contable P&L (ingresos - costo_ventas)
  materialMarginPctAvg: number; // margen via BOM/standard_price 12m
}

/**
 * Expone la comparación entre margen del P&L (contable) y margen material
 * de CMA/PMA (via BOM + standard_price). Si overhead_factor_pct ≈ 0, el
 * cost basis en odoo_products está capturando COGS correctamente y CMA
 * es confiable. Si diverge mucho, CMA sub/sobre-estima margen.
 */
export async function getOverheadFactor(): Promise<OverheadFactor | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("overhead_factor_12m")
    .select("*")
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, number | string | null>;
  return {
    totalRevenuePl: Number(d.total_revenue_pl) || 0,
    totalCogsPl: Number(d.total_cogs_pl) || 0,
    totalGrossProfitPl: Number(d.total_gross_profit_pl) || 0,
    overheadFactorPct: Number(d.overhead_factor_pct) || 0,
    realGrossMarginPct: Number(d.real_gross_margin_pct) || 0,
    materialMarginPctAvg: Number(d.material_margin_pct_avg) || 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Data Quality invariants (desde RPC dq_invariants + view dq_current_issues)
// ──────────────────────────────────────────────────────────────────────────
export interface DqInvariant {
  check_name: string;
  severity: "CRITICAL" | "HIGH" | "WARNING" | "INFO";
  ok: boolean;
  value: string;
  expected: string;
  message: string;
}

/**
 * Llama la RPC `dq_invariants()` que evalúa 14 invariantes clave del
 * sistema (consistency cross-page, coverage, RPC health, data quality).
 * Diseñada para:
 *   - Surface en /system como panel de salud
 *   - Prevenir regresiones tipo M3 CASCADE que rompieron views silenciosamente
 */
export async function getDqInvariants(): Promise<DqInvariant[]> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("dq_invariants");
  if (error) {
    console.error("[dq_invariants]", error.message);
    return [];
  }
  return (data ?? []) as DqInvariant[];
}

// ──────────────────────────────────────────────────────────────────────────
// Sync freshness per table
// ──────────────────────────────────────────────────────────────────────────
export interface SyncFreshnessRow {
  table_name: string;
  row_count: number;
  status: string;
  hours_ago: number | null;
  last_sync: string | null;
}

export async function getSyncFreshness(): Promise<SyncFreshnessRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_sync_freshness") // SP5-EXCEPTION: /sistema diagnostic
    .select("table_name, row_count, status, hours_ago, last_sync")
    .order("hours_ago", { ascending: false, nullsFirst: false });
  return ((data ?? []) as Array<{
    table_name: string;
    row_count: number | null;
    status: string | null;
    hours_ago: number | string | null;
    last_sync: string | null;
  }>).map((r) => ({
    table_name: r.table_name,
    row_count: Number(r.row_count) || 0,
    status: r.status ?? "unknown",
    hours_ago: r.hours_ago != null ? Number(r.hours_ago) : null,
    last_sync: r.last_sync,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Claude cost breakdown
// ──────────────────────────────────────────────────────────────────────────
export interface CostRow {
  endpoint: string;
  model: string;
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  cost24hUsd: number;
  cost7dUsd: number;
  cost30dUsd: number;
  calls24h: number;
  lastCall: string | null;
}

export async function getCostBreakdown(): Promise<CostRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("claude_cost_summary")
    .select("*")
    .order("total_cost_usd", { ascending: false });
  return ((data ?? []) as Array<{
    endpoint: string | null;
    model: string | null;
    calls: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
    total_cost_usd: number | null;
    cost_24h: number | null;
    cost_7d: number | null;
    cost_30d: number | null;
    calls_24h: number | null;
    last_call: string | null;
  }>).map((r) => ({
    endpoint: r.endpoint ?? "—",
    model: r.model ?? "—",
    calls: Number(r.calls) || 0,
    totalInputTokens: Number(r.total_input_tokens) || 0,
    totalOutputTokens: Number(r.total_output_tokens) || 0,
    totalCostUsd: Number(r.total_cost_usd) || 0,
    cost24hUsd: Number(r.cost_24h) || 0,
    cost7dUsd: Number(r.cost_7d) || 0,
    cost30dUsd: Number(r.cost_30d) || 0,
    calls24h: Number(r.calls_24h) || 0,
    lastCall: r.last_call,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Agent effectiveness
// ──────────────────────────────────────────────────────────────────────────
export interface AgentEffectivenessRow {
  agent_id: number;
  slug: string;
  name: string;
  domain: string | null;
  is_active: boolean;
  total_insights: number;
  insights_24h: number;
  state_new: number;
  state_acted: number;
  state_dismissed: number;
  acted_rate_pct: number | null;
  dismiss_rate_pct: number | null;
  avg_confidence: number | null;
  avg_impact_mxn: number | null;
  impact_delivered_mxn: number | null;
  last_run_at: string | null;
  runs_24h: number;
  avg_duration_s: number | null;
}

export async function getAgentEffectiveness(): Promise<
  AgentEffectivenessRow[]
> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_effectiveness")
    .select("*")
    .eq("is_active", true)
    .order("total_insights", { ascending: false });
  return ((data ?? []) as Array<Partial<AgentEffectivenessRow>>).map((r) => ({
    agent_id: Number(r.agent_id) || 0,
    slug: r.slug ?? "—",
    name: r.name ?? "—",
    domain: r.domain ?? null,
    is_active: !!r.is_active,
    total_insights: Number(r.total_insights) || 0,
    insights_24h: Number(r.insights_24h) || 0,
    state_new: Number(r.state_new) || 0,
    state_acted: Number(r.state_acted) || 0,
    state_dismissed: Number(r.state_dismissed) || 0,
    acted_rate_pct: r.acted_rate_pct != null ? Number(r.acted_rate_pct) : null,
    dismiss_rate_pct:
      r.dismiss_rate_pct != null ? Number(r.dismiss_rate_pct) : null,
    avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
    avg_impact_mxn:
      r.avg_impact_mxn != null ? Number(r.avg_impact_mxn) : null,
    impact_delivered_mxn:
      r.impact_delivered_mxn != null ? Number(r.impact_delivered_mxn) : null,
    last_run_at: r.last_run_at ?? null,
    runs_24h: Number(r.runs_24h) || 0,
    avg_duration_s:
      r.avg_duration_s != null ? Number(r.avg_duration_s) : null,
  }));
}

/**
 * Get a single agent by slug, joined with its effectiveness metrics.
 */
export async function getAgentBySlug(slug: string): Promise<
  | (AgentEffectivenessRow & {
      description: string | null;
      analysis_schedule: string | null;
    })
  | null
> {
  const sb = getServiceClient();
  const { data: agentData } = await sb
    .from("ai_agents")
    .select("id, slug, name, domain, description, analysis_schedule, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (!agentData) return null;

  const ag = agentData as {
    id: number;
    slug: string;
    name: string;
    domain: string | null;
    description: string | null;
    analysis_schedule: string | null;
    is_active: boolean | null;
  };

  const { data: effData } = await sb
    .from("agent_effectiveness")
    .select("*")
    .eq("agent_id", ag.id)
    .maybeSingle();
  const e = (effData ?? {}) as Partial<AgentEffectivenessRow>;

  return {
    agent_id: ag.id,
    slug: ag.slug,
    name: ag.name,
    domain: ag.domain,
    is_active: !!ag.is_active,
    description: ag.description,
    analysis_schedule: ag.analysis_schedule,
    total_insights: Number(e.total_insights) || 0,
    insights_24h: Number(e.insights_24h) || 0,
    state_new: Number(e.state_new) || 0,
    state_acted: Number(e.state_acted) || 0,
    state_dismissed: Number(e.state_dismissed) || 0,
    acted_rate_pct:
      e.acted_rate_pct != null ? Number(e.acted_rate_pct) : null,
    dismiss_rate_pct:
      e.dismiss_rate_pct != null ? Number(e.dismiss_rate_pct) : null,
    avg_confidence:
      e.avg_confidence != null ? Number(e.avg_confidence) : null,
    avg_impact_mxn:
      e.avg_impact_mxn != null ? Number(e.avg_impact_mxn) : null,
    impact_delivered_mxn:
      e.impact_delivered_mxn != null ? Number(e.impact_delivered_mxn) : null,
    last_run_at: e.last_run_at ?? null,
    runs_24h: Number(e.runs_24h) || 0,
    avg_duration_s:
      e.avg_duration_s != null ? Number(e.avg_duration_s) : null,
  };
}

export interface AgentRunRow {
  id: number;
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  entities_analyzed: number | null;
  insights_generated: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
}

export async function getAgentRuns(
  agentId: number,
  limit = 20
): Promise<AgentRunRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_runs")
    .select(
      "id, status, started_at, completed_at, duration_seconds, entities_analyzed, insights_generated, input_tokens, output_tokens, error_message"
    )
    .eq("agent_id", agentId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AgentRunRow[];
}

export interface AgentMemoryRow {
  id: number;
  memory_type: string | null;
  content: string | null;
  importance: number | null;
  times_used: number | null;
  last_used_at: string | null;
  created_at: string | null;
}

export async function getAgentMemory(
  agentId: number,
  limit = 20
): Promise<AgentMemoryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_memory")
    .select(
      "id, memory_type, content, importance, times_used, last_used_at, created_at"
    )
    .eq("agent_id", agentId)
    .order("importance", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as AgentMemoryRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// Data quality
// ──────────────────────────────────────────────────────────────────────────
export interface DataQualityRow {
  category: string;
  metric: string;
  value: number;
  threshold: number;
  severity: string;
  description: string | null;
}

export async function getDataQuality(): Promise<DataQualityRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("data_quality_scorecard")
    .select("*");
  return ((data ?? []) as Array<{
    category: string | null;
    metric: string | null;
    value: number | null;
    threshold: number | null;
    severity: string | null;
    description: string | null;
  }>)
    .map((r) => ({
      category: r.category ?? "—",
      metric: r.metric ?? "—",
      value: Number(r.value) || 0,
      threshold: Number(r.threshold) || 0,
      severity: r.severity ?? "info",
      description: r.description,
    }))
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 } as Record<
        string,
        number
      >;
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Notification queue
// ──────────────────────────────────────────────────────────────────────────
export interface NotificationRow {
  id: number;
  channel: string | null;
  status: string | null;
  priority: string | null;
  recipient_name: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  sent_at: string | null;
  error_message: string | null;
}

export async function getNotifications(
  limit = 20
): Promise<NotificationRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("notification_queue") // SP5-EXCEPTION: /sistema diagnostic — will be dropped T29
    .select(
      "id, channel, status, priority, recipient_name, title, body, created_at, sent_at, error_message"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline logs
// ──────────────────────────────────────────────────────────────────────────
export interface PipelineLogRow {
  id: string;
  level: string | null;
  phase: string | null;
  message: string | null;
  created_at: string | null;
}

export async function getPipelineLogs(
  limit = 50
): Promise<PipelineLogRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pipeline_logs") // SP5-EXCEPTION: /sistema diagnostic
    .select("id, level, phase, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PipelineLogRow[];
}

export interface PipelineLogsPage {
  rows: PipelineLogRow[];
  total: number;
}

export async function getPipelineLogsPage(
  params: import("./table-params").TableParams & {
    level?: string[];
    phase?: string[];
  }
): Promise<PipelineLogsPage> {
  const { paginationRange, endOfDay } = await import("./table-params");
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("pipeline_logs") // SP5-EXCEPTION: /sistema diagnostic
    .select("id, level, phase, message, created_at", { count: "exact" });

  if (params.q) query = query.ilike("message", `%${params.q}%`);
  if (params.level && params.level.length > 0) {
    query = query.in("level", params.level);
  }
  if (params.phase && params.phase.length > 0) {
    query = query.in("phase", params.phase);
  }
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("created_at", next);
  }

  const { data, count } = await query
    .order("created_at", { ascending, nullsFirst: false })
    .range(start, end);

  return { rows: (data ?? []) as PipelineLogRow[], total: count ?? 0 };
}

export async function getPipelineLogPhaseOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pipeline_logs") // SP5-EXCEPTION: /sistema diagnostic
    .select("phase")
    .not("phase", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ phase: string | null }>) {
    if (r.phase) set.add(r.phase);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}
