/**
 * Agent Orchestrator v4 — Parallel execution, model routing.
 *
 * v4 improvements:
 * - PARALLEL: Runs up to 3 agents per invocation (was 1)
 * - MODEL ROUTING: Haiku for meta/cleanup, Sonnet for business agents
 * - All v3 features: dedup, adaptive thresholds, smart memory, etc.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { sanitizeEmailForClaude } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase-server";
import { computeExpiresAt } from "@/lib/insight-ttl";
import { computeAdaptiveThreshold } from "@/lib/agents/confidence-threshold";
import { loadDirectorConfig, filterInsightsByConfig } from "@/lib/agents/director-config";
import { hasConcreteEvidence, looksLikeMetaHallucination } from "@/lib/agents/grounding";
import { buildFinancieroContextOperativo, buildFinancieroContextEstrategico } from "@/lib/agents/financiero-context";
import { advanceMode } from "@/lib/agents/mode-rotation";
import { buildComplianceContextOperativo, buildComplianceContextEstrategico } from "@/lib/agents/compliance-context";
import { applyFiscalAnnotation } from "@/lib/agents/fiscal-annotation";
import { getDirectorBriefing, type DirectorSlug, type DirectorBriefing } from "@/lib/queries/intelligence/evidence";

export const maxDuration = 300;

/** Max chars for the context sent to Claude (~6-7K tokens).
 *  Dropped from 40K to 25K in audit 2026-04-15 sprint 2. The original
 *  40K was set defensively but measurement showed directors rarely used
 *  >25K chars of context (the last third got truncated into noise
 *  anyway). Saves ~40% of fresh input tokens per director call; prompt
 *  caching already handles the stable system prompt, so the savings
 *  hit the per-call cost directly. */
const MAX_CONTEXT_CHARS = 25_000;

/** Default confidence threshold — raised from 0.65 to prevent noise */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.80;

/** Max insights per agent per run — prevents flooding the inbox */
const MAX_INSIGHTS_PER_RUN = 3;

/** Old agents that should NOT generate insights (deactivated but kept for safety).
 *  NOTE: `data_quality` fue removido el 13-abr-2026. Era un director activo
 *  que estaba doblemente bloqueado (aqui + analysis_schedule='manual'), por eso
 *  no corrio desde abril 1. Ver migration 042_director_integrity_phase1.sql. */
const SILENT_AGENTS = new Set(["meta", "cleanup", "odoo"]);

/** Severities validas segun schema de agent_insights */
const VALID_SEVERITIES = new Set(["medium", "high", "critical"]);

/** Fixed category catalog — Claude MUST use one of these */
const VALID_CATEGORIES = [
  "cobranza",          // Cartera vencida, pagos pendientes, flujo de caja
  "ventas",            // CRM, pipeline, oportunidades, clientes
  "entregas",          // Logística, envíos, entregas tardías
  "operaciones",       // Producción, manufactura, inventario, calidad
  "proveedores",       // Compras, cuentas por pagar, cadena de suministro
  "riesgo",            // Riesgo financiero, churn, concentración
  "equipo",            // Performance de empleados, actividades vencidas
  "datos",             // Calidad de datos, integridad, sistema
] as const;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });

  const supabase = getServiceClient();
  const start = Date.now();

  try {
    // ── Find which agent needs to run next ──────────────────────────────
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("id, slug, name, domain, system_prompt, analysis_schedule")
      .eq("is_active", true)
      .neq("analysis_schedule", "manual")
      .order("id");

    if (!agents?.length) {
      return NextResponse.json({ success: true, message: "No active agents" });
    }

    // Get last run time per agent
    const { data: lastRuns } = await supabase
      .from("agent_runs")
      .select("agent_id, started_at")
      .eq("status", "completed")
      .order("started_at", { ascending: false });

    const lastRunMap = new Map<number, string>();
    for (const run of lastRuns ?? []) {
      if (!lastRunMap.has(run.agent_id)) {
        lastRunMap.set(run.agent_id, run.started_at);
      }
    }

    // Run 1 agent at a time for quality over quantity (was 3, caused flooding)
    const MAX_PARALLEL = 1;

    // Respect `analysis_schedule`: daily agents need >=20h since last run,
    // weekly agents need >=7 days. Without this filter, every agent was running
    // ~5-7 times/day regardless of its declared cadence (see audit 2026-04-15).
    const now = Date.now();
    const MIN_INTERVAL_MS: Record<string, number> = {
      daily:   20 * 3600_000,       // ~once a day, leaves slack for missed crons
      weekly:  6 * 86400_000,       // ~once a week, slack for missed crons
      hourly:  50 * 60_000,
    };
    const complianceEnabled = process.env.ENABLE_COMPLIANCE_DIRECTOR !== "false";
    const eligibleAgents = agents.filter(a => {
      // Fase 6: ENABLE_COMPLIANCE_DIRECTOR=false desactiva el director sin
      // tener que ALTER is_active en DB. Rollback en caliente vía env var.
      if (a.slug === "compliance" && !complianceEnabled) return false;
      const schedule = String(a.analysis_schedule ?? "daily").toLowerCase();
      const minInterval = MIN_INTERVAL_MS[schedule] ?? 0;
      if (minInterval === 0) return true; // unknown schedule → let it run
      const last = lastRunMap.get(a.id);
      if (!last) return true; // never run → always eligible
      return now - new Date(last).getTime() >= minInterval;
    });

    if (!eligibleAgents.length) {
      return NextResponse.json({
        success: true,
        message: "No agents due per analysis_schedule",
        agents_ran: 0,
        insights_generated: 0,
        insights_archived: 0,
        duplicates_skipped: 0,
        elapsed_s: 0,
      });
    }

    const sortedAgents = [...eligibleAgents].sort((a, b) => {
      const aRun = lastRunMap.get(a.id);
      const bRun = lastRunMap.get(b.id);
      if (!aRun && !bRun) return 0;
      if (!aRun) return -1;
      if (!bRun) return 1;
      return new Date(aRun).getTime() - new Date(bRun).getTime();
    });
    const targetAgents = sortedAgents.slice(0, MAX_PARALLEL);

    console.log(`[orchestrate] Running ${targetAgents.length} agents in parallel: ${targetAgents.map(a => a.slug).join(", ")}`);

    // ── Run agents in parallel ──────────────────────────────────────────
    const agentResults = await Promise.allSettled(
      targetAgents.map(agent => runSingleAgent(apiKey, supabase, agent, start))
    );

    const summary = [];
    let totalInsights = 0;
    let totalArchived = 0;
    let totalDupes = 0;

    for (let i = 0; i < agentResults.length; i++) {
      const result = agentResults[i];
      const agent = targetAgents[i];
      if (result.status === "fulfilled") {
        summary.push({ agent: agent.slug, ...result.value });
        totalInsights += result.value.insights_generated;
        totalArchived += result.value.insights_archived;
        totalDupes += result.value.duplicates_skipped;
      } else {
        summary.push({ agent: agent.slug, error: String(result.reason) });
      }
    }

    const recentThreshold = new Date(Date.now() - 4 * 3600_000).toISOString();
    const agentsNeedingRun = agents.filter(a => {
      if (targetAgents.find(t => t.id === a.id)) return false;
      const last = lastRunMap.get(a.id);
      return !last || last < recentThreshold;
    }).length;

    return NextResponse.json({
      success: true,
      agents_ran: targetAgents.length,
      insights_generated: totalInsights,
      insights_archived: totalArchived,
      duplicates_skipped: totalDupes,
      elapsed_s: Math.round((Date.now() - start) / 1000),
      remaining_agents: Math.max(0, agentsNeedingRun),
      details: summary,
    });
  } catch (err) {
    console.error("[orchestrate] Fatal error:", err);
    try {
      const sb = getServiceClient();
      await sb.from("pipeline_logs").insert({
        level: "error",
        phase: "agent_orchestration",
        message: `Fatal orchestration error: ${err instanceof Error ? err.message : String(err)}`,
        details: { stack: err instanceof Error ? err.stack : undefined },
      });
    } catch { /* don't let logging failure mask original error */ }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Model routing: Opus for strategic, Sonnet for business, Haiku for routine ──
const AGENT_MODEL_MAP: Record<string, string> = {
  meta: "claude-haiku-4-5-20251001",      // Evaluation, not deep reasoning
  cleanup: "claude-haiku-4-5-20251001",   // Classification/enrichment
  // Everything else: Sonnet (reliable JSON output)
};

function getModelForAgent(slug: string): string {
  return AGENT_MODEL_MAP[slug] ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
}

// ── Run a single agent (called in parallel) ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runSingleAgent(apiKey: string, supabase: any, agent: any, batchStart: number) {
  const isSilent = SILENT_AGENTS.has(agent.slug);

  const { data: run } = await supabase
    .from("agent_runs")
    .insert({ agent_id: agent.id, status: "running", trigger_type: "orchestrator" })
    .select("id")
    .single();
  const runId = run?.id;
  const agentStart = Date.now();

  // Silent agents: just log the run, don't call Claude for insights
  if (isSilent) {
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "completed", completed_at: new Date().toISOString(),
        duration_seconds: 0, insights_generated: 0,
      }).eq("id", runId);
    }
    return { insights_generated: 0, insights_archived: 0, duplicates_skipped: 0, model: "skipped", elapsed_s: 0 };
  }

  try {
    const directorConfig = await loadDirectorConfig(supabase, agent.id);

    // Pre-load companies into a local map (kills N+1 in dedup loop + avoids global mutable state).
    const { data: companiesPreload } = await supabase
      .from("companies")
      .select("id, canonical_name")
      .limit(5000);
    const companyNameToId = new Map<string, number>();
    const companyIdToName = new Map<number, string>();
    for (const c of (companiesPreload ?? []) as Array<{ id: number; canonical_name: string }>) {
      if (c.canonical_name) {
        companyNameToId.set(c.canonical_name.toLowerCase(), c.id);
        companyIdToName.set(c.id, c.canonical_name);
      }
    }

    const context = await buildAgentContext(supabase, agent.domain, agent.id, directorConfig, companyIdToName);

    const { data: memories } = await supabase
      .from("agent_memory")
      .select("id, content, importance, updated_at")
      .eq("agent_id", agent.id)
      .gt("importance", 0.2)
      .order("importance", { ascending: false })
      .limit(15);

    const now = Date.now();
    const scoredMemories = (memories ?? [])
      .map((m: { id: number; content: string; importance: number; updated_at: string }) => {
        const ageDays = (now - new Date(m.updated_at).getTime()) / 86400_000;
        const recencyFactor = Math.max(0.3, 1 - ageDays / 90);
        return { ...m, score: m.importance * recencyFactor };
      })
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 10);

    const memoryText = scoredMemories.length
      ? `\n\nTus observaciones previas (aprende de estas):\n${scoredMemories.map((m: { content: string }) => `- ${m.content}`).join("\n")}`
      : "";

    if (scoredMemories.length) {
      const memoryIds = scoredMemories.map((m: { id: number }) => m.id);
      const { error: rpcErr } = await supabase.rpc("increment_memory_usage", { memory_ids: memoryIds });
      if (rpcErr) console.warn(`[orchestrate] increment_memory_usage failed:`, rpcErr.message);
    }

    const confidenceThreshold = await getAgentConfidenceThreshold(supabase, agent.id);
    // Piso adicional desde config (si está seteado)
    const effectiveThreshold = Math.max(confidenceThreshold, directorConfig.min_confidence_floor);
    const model = getModelForAgent(agent.slug);

    let insights: Record<string, unknown>[] = [];
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    try {
      const response = await callClaudeJSON<Record<string, unknown>[] | Record<string, unknown>>(
        apiKey,
        {
          model,
          max_tokens: 4096,
          temperature: 0.2,
          system: agent.system_prompt + AGENT_SYSTEM_SUFFIX,
          messages: [{
            role: "user",
            content: buildAgentPrompt(context, memoryText, effectiveThreshold),
          }],
        },
        `agent-${agent.slug}`
      );
      usage = response.usage;
      // Handle both array and object-with-array responses
      const raw = response.result;
      if (Array.isArray(raw)) {
        insights = raw;
      } else if (raw && typeof raw === "object" && "insights" in raw && Array.isArray(raw.insights)) {
        insights = raw.insights as Record<string, unknown>[];
      } else {
        insights = [];
      }
    } catch (claudeErr) {
      console.error(`[orchestrate] ${agent.slug} Claude/JSON error:`, claudeErr);
      // Return empty instead of crashing — agent will retry next cycle
      insights = [];
    }

    // Aggressive deduplication: cross-agent, by company+topic
    let duplicatesSkipped = 0;
    const filteredInsights = [];
    if (insights.length > 0) {
      // Check ALL recent insights (including expired) to prevent re-generating same insight.
      // Window ampliado de 72h → 7d (13-abr-2026): con 72h los mismos insights de
      // COSMO MODA / Elena Delgado reaparecieron 10x en 14 dias porque entre corridas
      // del agente pasaban mas de 3 dias y el dedup no los veia.
      const { data: existing } = await supabase
        .from("agent_insights").select("title, company_id, category")
        .in("state", ["new", "seen", "expired"])
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString()) // last 7 days
        .order("created_at", { ascending: false }).limit(1000);

      const existingTitles = new Set<string>((existing ?? []).map((i: { title: string }) => normalizeForDedup(i.title)));
      const existingCompanyCat = new Set<string>(
        (existing ?? []).filter((i: { company_id: number | null }) => i.company_id)
          .map((i: { company_id: number; category: string }) => `${i.company_id}:${i.category}`)
      );
      // Track semantic themes for cross-director dedup
      const existingThemes = new Set<string>();
      for (const i of (existing ?? []) as { title: string; company_id: number | null }[]) {
        const theme = extractTheme(i.title, null); // company name not available, use title only
        if (theme) existingThemes.add(theme);
      }

      for (const insight of insights) {
        const norm = normalizeForDedup(String(insight.title || ""));
        if (existingTitles.has(norm)) { duplicatesSkipped++; continue; }

        // Semantic theme dedup: "inventario muerto" = "dead stock" regardless of wording
        const companyName = String(insight.company_name || "").trim().toLowerCase();
        const theme = extractTheme(String(insight.title || ""), companyName);
        if (theme && existingThemes.has(theme)) {
          // FASE 3: Instead of just skipping, create a ticket to enrich the existing insight
          try {
            const existingInsight = (existing ?? []).find((e: { title: string }) => {
              const eTheme = extractTheme(e.title, null);
              return eTheme === theme;
            }) as { id?: number } | undefined;
            if (existingInsight?.id && insight.description) {
              await supabase.from("agent_tickets").insert({
                from_agent_id: agent.id,
                to_agent_id: null, // will be resolved
                insight_id: existingInsight.id,
                ticket_type: "enrich",
                message: `${agent.name} agrega contexto: ${String(insight.title).slice(0, 100)} — ${String(insight.description).slice(0, 200)}`,
              });
            }
          } catch { /* don't break dedup on ticket error */ }
          duplicatesSkipped++;
          continue;
        }

        // Cross-director dedup by company+category
        const category = normalizeCategory(String(insight.category || agent.domain));
        // Title word overlap check (works for ALL insights, with or without company)
        const titleWords = norm.split(" ").filter(w => w.length > 3);
        if (titleWords.length >= 3) {
          const hasSimilar = [...existingTitles].some(existing => {
            const overlap = titleWords.filter(w => existing.includes(w)).length;
            return overlap >= Math.min(3, titleWords.length * 0.5);
          });
          if (hasSimilar) { duplicatesSkipped++; continue; }
        }

        // Company+category dedup (only if we have a company name)
        if (companyName && companyName !== "null") {
          const coId = companyNameToId.get(companyName);
          if (coId !== undefined && existingCompanyCat.has(`${coId}:${category}`)) {
            duplicatesSkipped++;
            continue;
          }
        }

        existingTitles.add(norm);
        if (theme) existingThemes.add(theme);
        // Track for cross-director dedup within this run
        if (companyName && companyName !== "null") {
          const coId2 = companyNameToId.get(companyName);
          if (coId2 !== undefined) existingCompanyCat.add(`${coId2}:${category}`);
        }
        filteredInsights.push(insight);
      }
    }

    // Enforce max insights per run
    const cappedInsights = filteredInsights.slice(0, MAX_INSIGHTS_PER_RUN);
    duplicatesSkipped += filteredInsights.length - cappedInsights.length;

    // Save insights
    let filteredRows: Array<Record<string, unknown> & { _srcIdx: number }> = [];
    if (cappedInsights.length > 0) {
      const rows: Array<Record<string, unknown> & { _srcIdx: number }> = [];
      for (let srcIdx = 0; srcIdx < cappedInsights.length; srcIdx++) {
        const i = cappedInsights[srcIdx];
        let companyId: number | null = null;
        if (i.company_name) {
          const coId = companyNameToId.get(String(i.company_name).trim().toLowerCase());
          if (coId !== undefined) companyId = coId;
        }
        if (!companyId && i.company_id) companyId = Number(i.company_id);
        let contactId: number | null = null;
        if (i.contact_email) {
          const { data: ct } = await supabase.from("contacts").select("id, company_id")
            .eq("email", String(i.contact_email).toLowerCase()).limit(1).single();
          if (ct) { contactId = ct.id; if (!companyId && ct.company_id) companyId = ct.company_id; }
        }
        const confidence = Math.min(1, Math.max(0, Number(i.confidence) || 0.5));

        // Filter out meta/system noise that shouldn't reach the CEO
        const titleStr = String(i.title || "");
        const isMeta = META_TITLE_PATTERNS.some(p => p.test(titleStr));
        if (isMeta) {
          duplicatesSkipped++;
          continue;
        }

        // Filter out likely unit-error margin insights (cost/kg vs price/m)
        // If title mentions "por debajo del costo" with >5x difference, it's a unit mismatch
        if (/\d+x\s+(por\s+)?(debajo|encima|below|above)/i.test(titleStr) ||
            /precio.*~?\d+x.*costo/i.test(titleStr)) {
          duplicatesSkipped++;
          continue;
        }

        // Grounding stop 1: meta hallucination (sesiones del CEO, participacion de directores, etc.)
        if (looksLikeMetaHallucination(i as Record<string, unknown>)) {
          duplicatesSkipped++;
          console.log(`[orchestrate] ${agent.slug} dropped meta hallucination: ${titleStr.slice(0, 80)}`);
          continue;
        }

        // Validate severity against enum — silently coerce to "medium" if Claude hallucinated
        const rawSeverity = String(i.severity || "medium").toLowerCase();
        const severity = VALID_SEVERITIES.has(rawSeverity) ? rawSeverity : "medium";

        // Validate business_impact_estimate — NaN/Infinity/negative become null
        let businessImpact: number | null = null;
        if (i.business_impact_estimate !== undefined && i.business_impact_estimate !== null) {
          const asNum = typeof i.business_impact_estimate === "number"
            ? i.business_impact_estimate
            : Number(String(i.business_impact_estimate).replace(/[^\d.-]/g, ""));
          if (Number.isFinite(asNum) && asNum >= 0) {
            businessImpact = asNum;
          }
        }

        // Grounding stop 2: concrete evidence check. If the insight does not reference
        // any ID from the provided context, force state='archived' (auditable, invisible to CEO).
        const isGrounded = hasConcreteEvidence(i as Record<string, unknown>, context);

        // Build recommendation from actions (backward compat) or use legacy field
        const actions = Array.isArray(i.actions) ? i.actions : [];
        const recommendation = actions.length > 0
          ? actions.map((a: { description?: string; assignee_name?: string }) =>
              `${a.assignee_name ?? "?"}: ${a.description ?? ""}`
            ).join(" | ")
          : (i.recommendation ? String(i.recommendation) : null);

        // Pick first action's assignee as the insight's primary assignee
        const primaryAction = actions[0] as { assignee_name?: string; assignee_role?: string } | undefined;

        const insightType = String(i.insight_type || "recommendation");
        const expiresAt = computeExpiresAt({ severity, insight_type: insightType });

        rows.push({
          agent_id: agent.id, run_id: runId,
          insight_type: insightType,
          category: normalizeCategory(String(i.category || agent.domain)),
          severity,
          title: String(i.title || ""), description: String(i.description || ""),
          evidence: i.evidence || [],
          recommendation,
          confidence,
          business_impact_estimate: businessImpact,
          company_id: companyId, contact_id: contactId,
          state: (confidence < effectiveThreshold || !isGrounded) ? "archived" : "new",
          expires_at: expiresAt.toISOString(),
          // Store actions in evidence for frontend access
          _srcIdx: srcIdx,
        });
      }
      // Apply per-director config filter (min_business_impact, max_insights, etc.)
      filteredRows = filterInsightsByConfig(rows, directorConfig);
      if (filteredRows.length < rows.length) {
        console.log(`[orchestrate] ${agent.slug} config filter: ${rows.length} → ${filteredRows.length}`);
      }

      // Fase 6: enriquecer con fiscal_annotation antes del INSERT.
      // applyFiscalAnnotation devuelve null si: company_id null, agent es compliance,
      // company sin issues open, o description ya menciona el flag (self-flag guard).
      // La annotation agrega el flag fiscal determinístico sin impactar el grounding,
      // que ya corrió antes. Costo: 1 RPC call por insight (<50ms cada una).
      const annotatedRows = await Promise.all(
        filteredRows.map(async ({ _srcIdx, ...r }) => {
          const annotation = await applyFiscalAnnotation(supabase, {
            company_id: (r.company_id as number | null) ?? null,
            agent_slug: agent.slug,
            description: String(r.description ?? ""),
          });
          return annotation ? { ...r, fiscal_annotation: annotation } : r;
        })
      );
      const annotatedCount = annotatedRows.filter(r => (r as Record<string, unknown>).fiscal_annotation != null).length;
      if (annotatedCount > 0) {
        console.log(`[orchestrate] ${agent.slug} fiscal_annotation added to ${annotatedCount}/${annotatedRows.length} rows`);
      }

      console.log(`[orchestrate] ${agent.slug} inserting ${annotatedRows.length} rows (from ${cappedInsights.length} capped, ${insights.length} raw)`);
      if (annotatedRows.length === 0) {
        console.warn(`[orchestrate] ${agent.slug} rows empty after filters. Sample titles: ${cappedInsights.slice(0, 3).map(i => String(i.title || "").slice(0, 60)).join(" | ")}`);
      }
      const { data: savedInsights, error: insertErr } = await supabase.from("agent_insights").insert(annotatedRows).select("id");
      if (insertErr) {
        console.error(`[orchestrate] ${agent.slug} insert error:`, JSON.stringify(insertErr));
        console.error(`[orchestrate] ${agent.slug} first row sample:`, JSON.stringify(filteredRows[0]).slice(0, 500));
      } else {
        console.log(`[orchestrate] ${agent.slug} inserted ${savedInsights?.length ?? 0} insights ok`);
      }

      // Save action_items linked to each insight
      if (savedInsights?.length) {
        const actionRows: Record<string, unknown>[] = [];
        for (let idx = 0; idx < filteredRows.length && idx < savedInsights.length; idx++) {
          const insight = cappedInsights[filteredRows[idx]._srcIdx];
          const insightId = savedInsights[idx].id;
          const actions = Array.isArray(insight.actions) ? insight.actions : [];

          for (const action of actions) {
            // Resolve assignee email from name
            let assigneeEmail: string | null = null;
            const aName = String(action.assignee_name ?? "").trim();
            if (aName) {
              const { data: user } = await supabase.from("odoo_users")
                .select("email, department")
                .ilike("name", `%${aName}%`)
                .limit(1).single();
              if (user) assigneeEmail = user.email;
            }

            actionRows.push({
              action_type: "follow_up",
              action_category: insight.category ?? "operaciones",
              description: String(action.description ?? ""),
              reason: String(insight.title ?? ""),
              priority: String(action.priority ?? "medium"),
              company_id: filteredRows[idx]?.company_id ?? null,
              contact_name: String(insight.company_name ?? ""),
              assignee_name: aName || null,
              assignee_email: assigneeEmail,
              alert_id: insightId,
              state: "pending",
              due_date: action.due_days
                ? new Date(Date.now() + Number(action.due_days) * 86400_000).toISOString().split("T")[0]
                : null,
            });
          }
        }
        if (actionRows.length > 0) {
          await supabase.from("action_items").insert(actionRows);
        }
      }
    }

    const activeInsights = filteredRows.filter(i => (Number(i.confidence) || 0.5) >= effectiveThreshold).length;
    const duration = (Date.now() - agentStart) / 1000;

    if (runId) {
      await supabase.from("agent_runs").update({
        status: "completed", completed_at: new Date().toISOString(),
        duration_seconds: Math.round(duration * 10) / 10,
        insights_generated: activeInsights,
        input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0,
      }).eq("id", runId);
    }
    if (usage) logTokenUsage(`agent-${agent.slug}`, model, usage.input_tokens, usage.output_tokens);

    return { insights_generated: activeInsights, insights_archived: filteredInsights.length - activeInsights, duplicates_skipped: duplicatesSkipped, model, elapsed_s: Math.round(duration) };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("agent_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: errMsg }).eq("id", runId);
    }
    throw err;
  }
}

// ── Adaptive confidence threshold per agent ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAgentConfidenceThreshold(supabase: any, agentId: number): Promise<number> {
  try {
    // Check if agent has a calibration memory with a learned threshold
    const { data: calibration } = await supabase
      .from("agent_memory")
      .select("content")
      .eq("agent_id", agentId)
      .eq("memory_type", "calibration")
      .order("importance", { ascending: false })
      .limit(1);

    if (calibration?.length) {
      // Extract threshold hint from calibration memory
      // e.g., "Los insights de severidad 'info' se descartan 80% del tiempo..."
      // If agent's low-severity insights get dismissed a lot, raise threshold
      const content = calibration[0].content.toLowerCase();
      if (content.includes("descartan") && content.includes("info")) {
        return 0.72; // Stricter for agents whose info-level insights get dismissed
      }
      if (content.includes("descartan") && content.includes("low")) {
        return 0.70;
      }
    }

    // Check recent acceptance rate from agent_effectiveness view (more accurate)
    // This uses the view that already computes acted_rate / dismiss_rate per agent
    const { data: eff } = await supabase
      .from("agent_effectiveness")
      .select("acted_rate_pct, dismiss_rate_pct, total_insights")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (eff && eff.total_insights >= 10) {
      const actedRate = Number(eff.acted_rate_pct ?? 0);
      const dismissRate = Number(eff.dismiss_rate_pct ?? 0);
      const total = Number(eff.total_insights ?? 0);

      const { count: expiredCount } = await supabase
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("state", "expired")
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());

      const acted = Math.round((actedRate / 100) * total);
      const dismissed = Math.round((dismissRate / 100) * total);
      return computeAdaptiveThreshold({
        acted,
        dismissed,
        expired: Number(expiredCount ?? 0),
        total,
      });
    }

    // Fallback to older logic for agents without effectiveness data yet
    const { data: recentFeedback } = await supabase
      .from("agent_insights")
      .select("state")
      .eq("agent_id", agentId)
      .in("state", ["acted_on", "dismissed"])
      .order("created_at", { ascending: false })
      .limit(30);

    if (recentFeedback && recentFeedback.length >= 10) {
      const actedOn = recentFeedback.filter((i: { state: string }) => i.state === "acted_on").length;
      const rate = actedOn / recentFeedback.length;
      if (rate < 0.3) return 0.85;
      if (rate < 0.5) return 0.80;
      if (rate > 0.8) return 0.70;
    }
  } catch {
    // Fallback to default
  }
  return DEFAULT_CONFIDENCE_THRESHOLD;
}

// ── Category normalization — maps Claude's free-text to fixed catalog ────
const CATEGORY_MAP: Record<string, string> = {
  // cobranza
  payment: "cobranza", cobranza: "cobranza", cartera_vencida: "cobranza", cuentas_por_cobrar: "cobranza",
  accounts_receivable: "cobranza", billing: "cobranza", flujo_de_caja: "cobranza", cash_flow: "cobranza",
  financial_risk: "cobranza", finance: "cobranza", financiero: "cobranza", finanzas: "cobranza",
  riesgo_financiero: "cobranza", gestion_riesgo_crediticio: "cobranza", control_credito: "cobranza",
  // ventas
  ventas: "ventas", sales: "ventas", crm: "ventas", churn: "ventas", upselling: "ventas", upsell: "ventas",
  client_relationship: "ventas", relaciones_comerciales: "ventas", relacion_cliente: "ventas",
  new_business: "ventas", desarrollo_negocio: "ventas", gestion_clientes: "ventas",
  customer_health: "ventas", ventas_clientes: "ventas", pricing: "ventas", segmentation: "ventas",
  // entregas
  delivery: "entregas", entregas: "entregas", logistics: "entregas", logistica: "entregas",
  // operaciones
  operations: "operaciones", operaciones: "operaciones", inventory: "operaciones", quality: "operaciones",
  manufacturing: "operaciones", operational: "operaciones", operativo: "operaciones",
  compliance: "operaciones", execution: "operaciones",
  // proveedores
  procurement: "proveedores", proveedores: "proveedores", supplier_concentration: "proveedores",
  supplier_relationship: "proveedores", supplier_management: "proveedores", compras: "proveedores",
  cuentas_por_pagar: "proveedores", accounts_payable: "proveedores", supply_chain: "proveedores",
  cadena_de_suministro: "proveedores", supplier_negotiation: "proveedores",
  // riesgo
  risk: "riesgo", riesgo: "riesgo", escalation: "riesgo", riesgo_cliente: "riesgo",
  riesgo_proveedor: "riesgo", riesgo_operativo: "riesgo", portfolio_concentration: "riesgo",
  // equipo
  communication: "equipo", equipo: "equipo", hr_compliance: "equipo", nomina: "equipo",
  operaciones_internas: "equipo",
  // datos
  data_quality: "datos", data_completeness: "datos", datos: "datos", calidad_datos: "datos",
  integridad_datos: "datos", pipeline_blocker: "datos",
  // meta categories → normalize to datos (internal system concerns)
  agent_calibration: "datos", process_improvement: "datos", efficiency: "datos",
  team_performance: "equipo", calibracion: "datos", meta: "datos",
};

/** Categories that are internal system noise — should NOT reach the CEO inbox */
const META_TITLE_PATTERNS = [
  // Agent self-reflection / calibration (NEVER show to CEO)
  /sesgo\s+(sistem|hacia|cr[ií]tico)/i,
  /calibraci[oó]n\s+(de|imposible|cr[ií]tica|requerida)/i,
  /director\s+\w+\s+(ausente|fantasma|subactivad)/i,
  /frecuencia\s+de\s+activaci/i,
  /aceptaci[oó]n/i,
  /tasa\s+de\s+aceptaci/i,
  /\d+%\s+de?\s+aceptaci/i,
  // System meta-analysis
  /diversificar\s+hacia/i,
  /diversificaci[oó]n\s+de\s+tipos/i,
  /patr[oó]n\s+(de\s+)?(desalineaci|rechazo)/i,
  /identificar\s+patr[oó]n\s+en\s+rechazos/i,
  /volumen\s+(bajo|insuficiente)/i,
  /validaci[oó]n\s+(prematura|estad[ií]stica|insuficiente)/i,
  /falsa\s+(confianza|calibraci)/i,
  /agentes?\s+con\s+\d+%/i,
  // "No data" false positives
  /sin\s+datos\s+(de|para|financier)/i,
  /no\s+incluye\s+(ning[uú]n\s+)?dataset/i,
  /prompt\s+(de\s+)?an[aá]lisis\s+no\s+contiene/i,
  // Agent talking about other agents
  /director\s+(de\s+)?\w+\s*:\s*\d+%\s+de\s+aceptaci/i,
  /fuga\s+de\s+valor/i,
  /punto\s+ciego/i,
  /alertas.*no\s+accionable/i,
];

function normalizeCategory(raw: string): string {
  const key = raw.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

  // Direct match
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];

  // Partial match: check if any key is contained
  for (const [k, v] of Object.entries(CATEGORY_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }

  // Fallback: check the original string for keywords
  const lower = raw.toLowerCase();
  if (lower.includes("cobr") || lower.includes("pago") || lower.includes("factura") || lower.includes("finanz")) return "cobranza";
  if (lower.includes("venta") || lower.includes("cliente") || lower.includes("crm")) return "ventas";
  if (lower.includes("entrega") || lower.includes("logist")) return "entregas";
  if (lower.includes("operac") || lower.includes("inventar") || lower.includes("calidad") || lower.includes("producc")) return "operaciones";
  if (lower.includes("proveedor") || lower.includes("compra") || lower.includes("supplier")) return "proveedores";
  if (lower.includes("riesgo") || lower.includes("risk")) return "riesgo";
  if (lower.includes("equipo") || lower.includes("emplead") || lower.includes("nomina") || lower.includes("rh")) return "equipo";
  if (lower.includes("dato") || lower.includes("data") || lower.includes("sistema")) return "datos";

  return "operaciones"; // safe default
}

// ── Deduplication helper ────────────────────────────────────────────────
function normalizeForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/\$[\d,.]+[km]?/g, "$X") // normalize monetary amounts
    .replace(/\d+/g, "N")              // normalize numbers
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract a semantic theme from an insight title for cross-director dedup.
 *  Two insights with the same theme are duplicates even if worded differently. */
function extractTheme(title: string, companyName: string | null): string | null {
  const t = title.toLowerCase();
  // Generic themes (no company needed)
  if (t.includes("inventario muerto") || t.includes("dead stock")) return "theme:dead_stock";
  if (t.includes("entregas atrasadas") || t.includes("acumulación crítica")) return "theme:entregas_atrasadas";
  // Company-specific themes
  const co = (companyName ?? "").toLowerCase().trim();
  if (!co || co === "null") return null;
  if (t.includes("actividades vencidas")) return `theme:${co}:actividades_vencidas`;
  if (t.includes("material bloqueado") || t.includes("rechazado")) return `theme:${co}:material_bloqueado`;
  if (t.includes("desabasto") || t.includes("pronóstico negativo")) return `theme:${co}:desabasto`;
  if (t.includes("sin respuesta") || t.includes("sin acción")) return `theme:${co}:sin_respuesta`;
  if (t.includes("vencid") || t.includes("overdue")) return `theme:${co}:vencido`;
  if (t.includes("churn") || t.includes("revenue_90d")) return `theme:${co}:churn`;
  if (t.includes("margen") || t.includes("margin")) return `theme:${co}:margen`;
  if (t.includes("proveedor único") || t.includes("concentración")) return `theme:${co}:concentracion`;
  return null;
}

// ── Structured prompt for agents ────────────────────────────────────────
// NOTE: This suffix is intentionally verbose (~4500 chars) so that combined
// with agent.system_prompt (591-2212 chars) the total exceeds 4000 chars,
// enabling Anthropic prompt caching which cuts cost ~70% on director calls.
// See src/lib/claude.ts for caching threshold logic.
const AGENT_SYSTEM_SUFFIX = `

## Contexto empresarial de Quimibond

Eres un director virtual de Quimibond, fabricante textil mexicano con sede en Toluca (Estado de Mexico). La empresa produce entretelas fusionables y telas no-tejidas para la industria automotriz (BMW, Nissan, VW), confeccion de ropa formal (sastres, vestidos), calzado deportivo, y aplicaciones tecnicas. Facturacion anual: ~$400M MXN. Principales clientes: maquiladoras nacionales, marcas de ropa, armadoras automotrices. Principales proveedores: empresas quimicas internacionales (Zwisstex de Suiza, otros de Alemania/Italia) y fabricantes locales de fibras (Khafitex, DAC). Moneda primaria: MXN. Moneda de importacion: USD y EUR con tipo de cambio aproximado 17.5 MXN/USD.

Tu rol como director: analizar los datos de tu dominio, identificar patrones criticos, y generar insights que el CEO pueda ACCIONAR de inmediato. No eres un reporte de status — eres un asesor estrategico que pide accion especifica con responsable y plazo.

## Reglas ESTRICTAS de output

1. **Volumen**: MAXIMO 3 insights por respuesta. Prioriza calidad sobre cantidad. Si no hay nada realmente importante o nuevo, devuelve array vacio []. Es MEJOR devolver [] que generar ruido. El CEO tiene tiempo limitado.

2. **Accionabilidad**: Cada insight DEBE poder convertirse en una accion concreta asignable a una persona con deadline. Si no puedes decir "Juan, haz X para el viernes", no es un insight valido. Reformulalo o descartalo.

3. **Sin duplicados**: No repitas insights que el CEO ya haya visto. Mejor devuelve [] que duplicar. El CEO se frustra cuando multiples directores le dicen lo mismo.

4. **Evidencia verificable obligatoria**: Cada entrada en "evidence" DEBE ser un dato con fuente identificable en los datos que recibiste. Ejemplos BUENOS:
   - "Factura INV/2026/03/0173 por $47,005 vencida 40 dias (proveedor: Khafitex)"
   - "Email de ventas@blantex.com.mx del 2-abr asunto 'Aumento precios abril' sin respuesta 117h"
   - "OC-06993-26: HILO POLYESTER 75/36 a $2.18 USD (promedio historico: $1.72, +26.7%)"
   - "Entrega TL/OUT/12781 a BMW Mexico atrasada 5 dias, scheduled 8-abr, pendiente"
   Ejemplos MALOS a rechazar: "hay facturas vencidas", "un email sin respuesta", "precios altos", "problema de entrega", "varios clientes con atraso".

5. **No inventar datos**: Si un dato no esta en el contexto que recibiste, no lo afirmes. Si tienes una hipotesis basada en patrones, marcala con confidence < 0.85.

6. **Categoria**: DEBE ser EXACTAMENTE una de estas 8 (sin variantes, sin plurales diferentes, sin mayusculas):
   - cobranza: facturas vencidas, clientes que no pagan, cartera, aging
   - ventas: oportunidades, clientes en riesgo de fuga, pipeline, cotizaciones
   - entregas: logistica, shipments, OTD rate, atrasos de envio
   - operaciones: manufactura, stock, produccion, calidad interna, paros
   - proveedores: compras, precios, lead times, calidad supplier, alternativas
   - riesgo: disputas, fraudes, problemas legales, eventos financieros graves
   - equipo: empleados, performance individual, carga de trabajo, burnout
   - datos: problemas de integridad detectados (uso raro, solo si es critico)

7. **Severity**: solo 3 valores validos. Usa "critical" solo para cosas que impactan >$1M MXN o deben resolverse HOY. "high" para problemas de >$100K MXN o deadline < 3 dias. "medium" para el resto. PROHIBIDO usar "info", "low", "warning" o cualquier otro valor — seran rechazados.

8. **Business impact**: Cuando sea posible calcular, business_impact_estimate debe ser en MXN (nunca USD). Si el monto original esta en USD, convertir multiplicando por 17.5. Si no puedes calcular razonablemente, usa null (no uses cero).

9. **Productos**: SIEMPRE usa product_ref (referencia interna tipo WM4032OW152, HI7536NT, etc.) para identificar productos. NO uses nombres largos como "HILO POLIESTER 75/36 NT NEGRO" porque hacen el insight ilegible.

10. **Auto-referencias**: IGNORA completamente empresas cuyo nombre contenga "quimibond", "productora de no tejidos", o variantes. Son la propia empresa, no clientes ni proveedores. Los movimientos entre ellas son transferencias internas, no transacciones.

11. **Errores de unidades**: Si ves margenes de -80% a -95% o precios de venta que son 3x+ MENORES que el costo, es casi seguro un error de unidades (costo por kg vs precio por metro, costo por bulto vs precio unitario). NO lo reportes como insight de negocio. Si la diferencia entre costo y precio es > 3x en cualquier direccion, IGNORALO completamente — es data quality, no business issue.

12. **Datos viejos prohibidos**: NO reportes datos viejos. Entregas de >6 meses no son accionables. Ordenes de >1 año tampoco. Emails de >30 dias rara vez importan salvo casos muy especificos. Si ves algo antiguo pero con consecuencia actual (ej: cliente del año pasado con factura aun vencida), contextualizalo en el presente.

13. **PROHIBIDO meta-insights**: NUNCA generes insights sobre el SISTEMA, los AGENTES, o la CALIDAD DE DATOS. No hables de tasas de aceptacion, calibracion, subactivacion, validacion estadistica, falsa confianza, sesgo, volumen de interacciones, o cualquier problema interno del sistema de inteligencia. Esos son problemas del sistema que el CEO NO debe ver. Si quieres señalar un dato faltante relevante, usalo en el campo "evidence" — pero el TITULO y DESCRIPCION del insight deben ser sobre el NEGOCIO, no sobre los agentes.

14. **Genericos prohibidos**: No generes insights vagos como "mejorar comunicacion con clientes", "revisar proceso de compras", "optimizar inventario". Cada insight debe mencionar una empresa especifica, un numero concreto, o un deadline puntual. Si no puedes ser especifico, no es un insight.

15. **Action items obligatorios**: cada insight debe tener 1-3 action items concretos. assignee_name debe ser el nombre EXACTO como aparece en los datos ("Guadalupe Guerrero" no "el equipo de ventas"). due_days entre 1 y 7 dias. priority debe alinearse con severity.`;

function buildAgentPrompt(context: string, memoryText: string, threshold: number): string {
  const truncatedContext = context.length > MAX_CONTEXT_CHARS
    ? context.slice(0, MAX_CONTEXT_CHARS) + "\n\n[...datos truncados por limite de tokens]"
    : context;

  return `Analiza los datos y genera SOLO insights que requieran accion inmediata. Confianza minima: ${threshold}. MAXIMO 3 insights.

Si no hay nada urgente o nuevo, devuelve []. Es mejor devolver [] que generar ruido.

IMPORTANTE: No repitas insights que otros directores ya hayan reportado.

${truncatedContext}${memoryText}

Responde con un JSON array. Cada elemento debe tener EXACTAMENTE estos campos:
{
  "title": "string — titulo conciso (empresa + problema + monto si aplica)",
  "description": "string — contexto en 1-2 oraciones",
  "insight_type": "opportunity|risk|anomaly|recommendation",
  "category": "cobranza|ventas|entregas|operaciones|proveedores|riesgo|equipo|datos",
  "severity": "medium|high|critical",
  "confidence": number 0.8-1.0,
  "actions": [
    {
      "description": "string — QUE hacer especificamente (verbo + objeto + plazo)",
      "assignee_name": "string — nombre EXACTO del responsable como aparece en los datos",
      "assignee_role": "string — rol/departamento del responsable",
      "priority": "high|medium|low",
      "due_days": number (1-7, en cuantos dias debe estar hecho)
    }
  ],
  "business_impact_estimate": number|null (MXN),
  "evidence": ["string — DATO VERIFICABLE con fuente: 'Factura INV/2026/03/0173 $47K vencida 40d' o 'Email de user@domain.com del 2-abr sin respuesta' o 'OC-06993 a $2.18 vs promedio $1.72'"],
  "company_name": "string exacto como aparece en datos|null",
  "contact_email": "string|null"
}

REGLAS para actions:
- Cada accion es para UNA persona especifica — nunca "el equipo" o "alguien"
- Si un insight requiere acciones de 2+ personas, pon CADA UNA como accion separada
- El nombre del responsable debe ser EXACTO como aparece en los datos (ej: "Elena Delgado Ruiz", "Dario Manriquez")
- Si no sabes quien es el responsable, pon al jefe del area relevante
- MINIMO 1 accion por insight, MAXIMO 3 acciones por insight`;
}

// ── Director briefing integration (PARTE 1: predictive evidence packs) ──
// Maps the agent's `domain` to the director slug used by the
// `get_director_briefing` RPC. Only the 7 business directors get briefings;
// everything else (sales, finance, meta, cleanup, predictive, suppliers, etc.)
// returns null and falls back to the legacy domain context.
const DOMAIN_TO_DIRECTOR: Record<string, DirectorSlug> = {
  comercial: "comercial",
  financiero: "financiero",
  operaciones_dir: "operaciones",
  compras: "compras",
  riesgo_dir: "riesgo",
  costos: "costos",
  equipo_dir: "equipo",
};

function fmtMxn(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "?";
  return `$${Math.round(Number(n)).toLocaleString("es-MX")}`;
}

function formatBriefingForAgent(briefing: DirectorBriefing): string {
  if (!briefing.evidence_packs?.length) return "";

  const blocks: string[] = [];
  blocks.push(
    `## EVIDENCE PACKS — top ${briefing.companies_analyzed} empresas que requieren atencion`
  );
  blocks.push(
    "Estos packs vienen del RPC get_director_briefing (datos reales, ya predigeridos). Cada pack incluye facturas vencidas concretas, vendedor responsable, predicciones de pago/reorden y comunicacion reciente. USA estos IDs y nombres EXACTOS en evidence."
  );

  for (const pack of briefing.evidence_packs) {
    const fin = pack.financials;
    const ord = pack.orders;
    const com = pack.communication;
    const del = pack.deliveries;
    const act = pack.activities;
    const pred = pack.predictions ?? null;
    const hist = pack.history;

    const lines: string[] = [];
    lines.push(`### ${pack.company_name} (id=${pack.company_id}, tier=${pack.tier ?? "standard"})`);
    if (pack.rfc) lines.push(`RFC: ${pack.rfc}`);
    if (pack.credit_limit != null) lines.push(`Credit limit: ${fmtMxn(pack.credit_limit)} MXN`);

    // Finance with concrete invoices
    const overdueInvoices = fin?.overdue_invoices ?? [];
    if (overdueInvoices.length) {
      const invLines = overdueInvoices.slice(0, 6).map(inv =>
        `  - ${inv.name ?? "?"} | ${fmtMxn(inv.amount_mxn)} MXN | vencida ${inv.days_overdue ?? "?"}d (due ${inv.due_date ?? "?"})`
      );
      lines.push(`Facturas vencidas (${overdueInvoices.length}):\n${invLines.join("\n")}`);
    }
    if (fin?.total_overdue_mxn != null) {
      lines.push(`Total vencido: ${fmtMxn(fin.total_overdue_mxn)} MXN`);
    }
    if (fin?.avg_days_to_pay != null) {
      lines.push(`Patron historico de pago: avg ${Number(fin.avg_days_to_pay).toFixed(0)}d`);
    }
    if (fin?.payables_overdue_mxn) {
      lines.push(`Les debemos (vencido): ${fmtMxn(fin.payables_overdue_mxn)} MXN`);
    }

    // Orders + person responsible
    if (ord?.salesperson) {
      lines.push(`Vendedor: ${ord.salesperson} <${ord.salesperson_email ?? "?"}>`);
    }
    if (ord?.last_order_date) {
      lines.push(`Ultimo pedido: ${ord.last_order_date} (${ord.days_since_last_order ?? "?"}d atras)`);
    }
    if (ord?.revenue_trend) {
      lines.push(`Revenue 90d vs prev: ${fmtMxn(ord.revenue_trend.last_3m)} vs ${fmtMxn(ord.revenue_trend.prev_3m)}`);
    }
    const topProducts = ord?.top_products ?? [];
    if (topProducts.length) {
      lines.push(`Top productos: ${topProducts.slice(0, 3).map(p => `${p.ref ?? p.product ?? "?"} (${fmtMxn(p.total_mxn)})`).join(", ")}`);
    }

    // Communication signals
    if (com?.days_since_last_email != null) {
      lines.push(`Dias sin email: ${com.days_since_last_email}, threads sin respuesta: ${com.unanswered_threads ?? 0}`);
    }
    const recentThreads = com?.recent_threads ?? [];
    if (recentThreads.length) {
      lines.push(`Threads recientes:\n${recentThreads.slice(0, 3).map(t => `  - "${sanitizeEmailForClaude(String(t.subject ?? ""), 80)}" ult sender: ${t.last_sender ?? "?"} (${t.hours_waiting ?? "?"}h waiting)`).join("\n")}`);
    }
    const keyContacts = com?.key_contacts ?? [];
    if (keyContacts.length) {
      lines.push(`Contactos clave: ${keyContacts.slice(0, 3).map(c => `${c.name} <${c.email}>`).join(", ")}`);
    }

    // Deliveries
    if (del && (del.late_deliveries || del.pending_shipments)) {
      lines.push(`Entregas: ${del.pending_shipments ?? 0} pendientes, ${del.late_deliveries ?? 0} tarde, OTD ${del.otd_rate ?? "?"}%`);
    }
    const lateDetails = del?.late_details ?? [];
    if (lateDetails.length) {
      lines.push(`Detalles late: ${lateDetails.slice(0, 3).map(d => `${d.name} (sched ${d.scheduled})`).join(", ")}`);
    }

    // Activities with assignees
    const overdueActs = act?.overdue_detail ?? [];
    if (overdueActs.length) {
      lines.push(`Actividades vencidas:\n${overdueActs.slice(0, 3).map(a => `  - ${a.type ?? "?"}: ${sanitizeEmailForClaude(String(a.summary ?? ""), 80)} → ${a.assigned_to ?? "?"} (deadline ${a.deadline ?? "?"})`).join("\n")}`);
    }

    // PREDICTIONS — the heart of PARTE 1
    if (pred?.payment) {
      const p = pred.payment;
      lines.push(
        `PREDICCION pago: predicted=${p.predicted_payment_date ?? "?"}, riesgo=${p.payment_risk ?? "?"}, trend=${p.payment_trend ?? "?"}, avg=${p.avg_days_to_pay ?? "?"}d, median=${p.median_days_to_pay ?? "?"}d, recent_6m=${p.avg_recent_6m ?? "?"}d`
      );
    }
    if (pred?.reorder) {
      const r = pred.reorder;
      lines.push(
        `PREDICCION reorden: ${r.reorder_status ?? "?"}, predicted=${r.predicted_next_order ?? "?"}, days_overdue=${r.days_overdue_reorder ?? 0}, ciclo=${r.avg_cycle_days ?? "?"}d, vendedor=${r.salesperson_name ?? "?"} <${r.salesperson_email ?? "?"}>`
      );
    }
    if (pred?.ltv_health) {
      const l = pred.ltv_health;
      lines.push(
        `LTV health: status=${l.customer_status ?? "?"}, churn_risk=${l.churn_risk_score ?? "?"}/100, overdue_risk=${l.overdue_risk_score ?? "?"}/100, trend=${l.trend_pct ?? "?"}%`
      );
    }
    if (pred?.cashflow) {
      const c = pred.cashflow;
      lines.push(
        `Cashflow esperado: ${fmtMxn(c.expected_collection)} MXN (prob ${c.collection_probability ?? "?"}, total receivable ${fmtMxn(c.total_receivable)})`
      );
    }

    // Recent insights — DO NOT REPEAT
    const recentInsights = hist?.recent_insights ?? [];
    if (recentInsights.length) {
      lines.push(`Insights previos (NO repetir):\n${recentInsights.slice(0, 4).map(i => `  - "${sanitizeEmailForClaude(String(i.title ?? ""), 100)}" [${i.state ?? "?"}/${i.category ?? "?"}]`).join("\n")}`);
    }

    blocks.push(lines.join("\n"));
  }

  // Agent feedback hints from briefing
  const fb = briefing.agent_feedback;
  if (fb) {
    const accepted = Array.isArray(fb.recent_acted_titles) ? fb.recent_acted_titles.slice(0, 5) : [];
    if (accepted.length) {
      blocks.push(`## PATRONES QUE EL CEO ACCIONO (replica este formato)\n${accepted.map(t => `- "${t}"`).join("\n")}`);
    }
  }

  if (briefing.instructions) {
    blocks.push(`## INSTRUCCIONES ESPECIFICAS DEL DIRECTOR\n${briefing.instructions}`);
  }

  return blocks.join("\n\n") + "\n\n";
}

// ── Context builders ──────────────────────────────────────────────────
async function buildAgentContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  domain: string,
  agentId?: number,
  directorConfig?: import("@/lib/agents/director-config").DirectorConfig,
  companyIdToName?: Map<number, string>
): Promise<string> {
  // PARTE 1: load director briefing in parallel with cross-cutting layers.
  // Only the 7 business directors get briefings; for the rest this is a no-op.
  const directorSlug = DOMAIN_TO_DIRECTOR[domain];
  const briefingPromise = directorSlug
    ? getDirectorBriefing(directorSlug, 5).catch(err => {
        console.warn(`[orchestrate] briefing fetch failed for ${directorSlug}:`, err?.message ?? err);
        return null;
      })
    : Promise.resolve(null);

  // Load 3 cross-cutting intelligence layers (all directors get these)
  const [emailFacts, emailIntel, recentFeedback, pendingTickets, recentKGFacts, myDismissed] = await Promise.all([
    // Email facts per company (reduced from 15 to 8)
    supabase
      .from("company_email_intelligence")
      .select("company_name, fact_type, fact_text")
      .in("fact_type", ["complaint", "commitment", "request", "price"])
      .limit(8),

    // Domain-specific email facts
    getEmailIntelligence(supabase, domain),

    // CEO feedback last 48h (reduced from 15 to 8)
    supabase
      .from("agent_insights")
      .select("title, state, category, severity, user_feedback")
      .in("state", ["acted_on", "dismissed"])
      .gte("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(8),

    // Tickets from other directors (reduced from 10 to 5)
    supabase
      .from("agent_tickets")
      .select("from_agent_id, insight_id, ticket_type, message, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),

    // High-confidence KG facts (reduced from 20 to 10)
    supabase
      .from("facts")
      .select("fact_text, fact_type, confidence, fact_date")
      .gte("confidence", 0.85)
      .eq("expired", false)
      .order("fact_date", { ascending: false, nullsFirst: false })
      .limit(10),

    // This agent's dismissals (kept at 8 — important for learning)
    agentId ? supabase
      .from("agent_insights")
      .select("title, category, user_feedback")
      .eq("agent_id", agentId)
      .in("state", ["dismissed"])
      .gte("updated_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(8) : Promise.resolve({ data: [] }),
  ]);

  const sections: string[] = [];

  // Email intelligence: actual quotes from communications
  if (emailFacts.data?.length) {
    sections.push(`## SEÑALES DE EMAILS (citas textuales de comunicaciones)\n${
      (emailFacts.data as Record<string, unknown>[]).map(f =>
        `- [${f.fact_type}] ${f.company_name}: "${sanitizeEmailForClaude(String(f.fact_text), 200)}"`
      ).join("\n")
    }`);
  }

  // FASE 4: Knowledge graph facts (verified intel from emails)
  if (recentKGFacts.data?.length) {
    const factsByType = new Map<string, string[]>();
    for (const f of (recentKGFacts.data ?? []) as Record<string, unknown>[]) {
      const type = String(f.fact_type ?? "info");
      if (!factsByType.has(type)) factsByType.set(type, []);
      factsByType.get(type)!.push(`${sanitizeEmailForClaude(String(f.fact_text), 150)}${f.fact_date ? ` (${f.fact_date})` : ""}`);
    }
    const factLines = [...factsByType.entries()]
      .map(([type, facts]) => `  [${type}]: ${facts.slice(0, 3).join(" | ")}`)
      .join("\n");
    sections.push(`## HECHOS VERIFICADOS del Knowledge Graph (extraidos de emails)\n${factLines}`);
  }

  // FASE 2: Recent CEO feedback (immediate loop)
  const acted = ((recentFeedback.data ?? []) as Record<string, unknown>[]).filter(i => i.state === "acted_on");
  const dismissed = ((recentFeedback.data ?? []) as Record<string, unknown>[]).filter(i => i.state === "dismissed");
  if (acted.length || dismissed.length) {
    const lines: string[] = [];
    for (const i of acted.slice(0, 5)) lines.push(`  ✅ "${i.title}" → CEO ACTUO (util)`);
    for (const i of dismissed.slice(0, 5)) lines.push(`  ❌ "${i.title}" → CEO DESCARTO${i.user_feedback ? ` (${i.user_feedback})` : ""}`);
    sections.push(`## FEEDBACK DEL CEO (ultimas 48h) — NO repitas los descartados\n${lines.join("\n")}`);
  }

  // FASE 3: Tickets from other directors
  if (pendingTickets.data?.length) {
    sections.push(`## TICKETS DE OTROS DIRECTORES (requieren tu atencion)\n${
      (pendingTickets.data as Record<string, unknown>[]).map(t =>
        `- [${t.ticket_type}] ${sanitizeEmailForClaude(String(t.message), 200)}`
      ).join("\n")
    }`);
  }

  // FASE 5: Per-agent dismissal patterns (learn from own mistakes)
  // Shows this specific director what kinds of insights the CEO recently rejected
  // so it can avoid repeating the same pattern
  if (myDismissed.data?.length) {
    const dismissedLines = (myDismissed.data as Record<string, unknown>[])
      .map(d => {
        const feedback = d.user_feedback ? ` [razon: ${String(d.user_feedback).slice(0, 80)}]` : "";
        return `  ❌ "${String(d.title).slice(0, 100)}" [${d.category}]${feedback}`;
      })
      .join("\n");
    sections.push(
      `## TUS ULTIMOS INSIGHTS DESCARTADOS POR EL CEO (no repitas este patron)\n` +
      `Aprende del rechazo: NO generes insights parecidos a estos.\n${dismissedLines}`
    );
  }

  const crossIntel = sections.length ? sections.join("\n\n") + "\n\n" : "";

  // Director briefing (predictive evidence packs) — top of context, before legacy domain data
  const briefing = await briefingPromise;
  const briefingSection = briefing ? formatBriefingForAgent(briefing) : "";

  const domainData = await getDomainData(supabase, domain, agentId, directorConfig, companyIdToName);
  return briefingSection + crossIntel + emailIntel + domainData;
}

/**
 * Loads facts, action_items, and complaints from the knowledge graph
 * filtered by relevance to each agent's domain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getEmailIntelligence(sb: any, domain: string): Promise<string> {
  const sections: string[] = [];

  // Domain-specific fact types and action filters
  const factFilters: Record<string, string[]> = {
    finance: ["price", "commitment", "complaint"],
    sales: ["request", "commitment", "price"],
    risk: ["complaint", "commitment", "change"],
    operations: ["commitment", "change", "complaint"],
    relationships: ["request", "complaint", "commitment"],
    growth: ["request", "price"],
    suppliers: ["price", "complaint", "change", "commitment"],
  };

  const actionFilters: Record<string, string[]> = {
    finance: ["review", "approve"],
    sales: ["follow_up", "send_quote", "call", "email"],
    risk: ["follow_up", "investigate"],
    operations: ["deliver", "review"],
    relationships: ["email", "call", "follow_up", "meeting"],
    growth: ["follow_up", "send_quote"],
    suppliers: ["review", "approve", "investigate"],
  };

  const relevantFactTypes = factFilters[domain];
  const relevantActionTypes = actionFilters[domain];

  if (!relevantFactTypes && !relevantActionTypes) return "";

  // Load relevant facts from knowledge graph
  if (relevantFactTypes) {
    const { data: facts } = await sb
      .from("facts")
      .select("fact_type, fact_text, confidence, created_at")
      .in("fact_type", relevantFactTypes)
      .gte("confidence", 0.85)
      .order("created_at", { ascending: false })
      .limit(15);

    if (facts?.length) {
      sections.push(`## Inteligencia de emails (hechos extraidos)\n${facts.map((f: { fact_type: string; fact_text: string }) =>
        `- [${f.fact_type}] ${sanitizeEmailForClaude(f.fact_text, 300)}`
      ).join("\n")}`);
    }
  }

  // Load relevant pending action_items
  if (relevantActionTypes) {
    const { data: actions } = await sb
      .from("action_items")
      .select("action_type, description, priority, contact_name, contact_company, company_id, assignee_name, due_date, state")
      .in("action_type", relevantActionTypes)
      .eq("state", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(15);

    if (actions?.length) {
      sections.push(`## Acciones pendientes (extraidas de emails)\n${actions.map((a: { action_type: string; description: string; priority: string; contact_name: string; assignee_name: string; due_date: string }) =>
        `- [${a.priority}] ${a.action_type}: ${sanitizeEmailForClaude(a.description, 150)}${a.contact_name ? ` (${a.contact_name})` : ""}${a.assignee_name ? ` → ${a.assignee_name}` : ""}${a.due_date ? ` vence: ${a.due_date}` : ""}`
      ).join("\n")}`);
    }
  }

  // Load overdue action_items (all domains care about overdue items for their people)
  const { data: overdue } = await sb
    .from("action_items")
    .select("action_type, description, priority, contact_name, assignee_name, due_date")
    .eq("state", "pending")
    .lt("due_date", new Date().toISOString().split("T")[0])
    .in("priority", ["high", "critical"])
    .order("due_date", { ascending: true })
    .limit(10);

  if (overdue?.length) {
    sections.push(`## Acciones VENCIDAS de alta prioridad\n${overdue.map((a: { description: string; assignee_name: string; due_date: string }) =>
      `- VENCIDA ${a.due_date}: ${sanitizeEmailForClaude(a.description, 120)} → ${a.assignee_name || "sin asignar"}`
    ).join("\n")}`);
  }

  // Load recent complaints (all domains should know about unhappy stakeholders)
  if (domain !== "growth" && domain !== "meta") {
    const { data: complaints } = await sb
      .from("facts")
      .select("fact_text, confidence, created_at")
      .eq("fact_type", "complaint")
      .gte("confidence", 0.9)
      .order("created_at", { ascending: false })
      .limit(5);

    if (complaints?.length && !sections.some(s => s.includes("complaint"))) {
      sections.push(`## Quejas/problemas detectados en emails\n${complaints.map((c: { fact_text: string }) =>
        `- ${sanitizeEmailForClaude(c.fact_text, 300)}`
      ).join("\n")}`);
    }
  }

  return sections.length ? sections.join("\n\n") + "\n\n" : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDomainData(sb: any, domain: string, agentId?: number, directorConfig?: import("@/lib/agents/director-config").DirectorConfig, companyIdToName?: Map<number, string>): Promise<string> {
  const nameMap = companyIdToName ?? new Map<number, string>();

  function safeJSON(data: unknown): string {
    if (!data) return "[]";
    let str = JSON.stringify(data);
    // Replace company_id with company name for readability
    if (nameMap.size > 0 && str.includes("company_id")) {
      str = str.replace(/"company_id"\s*:\s*(\d+)/g, (match, id) => {
        const name = nameMap.get(Number(id));
        return name ? `"empresa":"${name}"` : match;
      });
    }
    if (str.length > 8000) return str.slice(0, 8000) + "...truncado]";
    return str;
  }

  // Load company narratives — consolidated intelligence per company
  // Replaces flat profiles with connected narratives (sales + finance + delivery + email + complaints)
  const needsNarratives = ["sales", "finance", "risk", "growth", "relationships", "suppliers", "predictive"];
  let profileSection = "";
  if (needsNarratives.includes(domain)) {
    // Companies with risk signals first (most actionable)
    const { data: narratives } = await sb
      .from("company_narrative")
      .select("canonical_name, tier, risk_level, total_revenue, revenue_90d, trend_pct, days_since_last_order, salespeople, top_products, pending_amount, overdue_amount, max_days_overdue, late_deliveries, otd_rate, emails_30d, complaints, commitments, requests, recent_complaints, total_purchases, risk_signal")
      .order("total_revenue", { ascending: false })
      .limit(30);

    if (narratives?.length) {
      // Split into: companies with risk signals vs healthy ones
      const atRisk = (narratives as Record<string, unknown>[]).filter(n => n.risk_signal);
      const healthy = (narratives as Record<string, unknown>[]).filter(n => !n.risk_signal).slice(0, 10);

      profileSection = atRisk.length
        ? `## EMPRESAS CON SEÑALES DE ALERTA (requieren atencion)\n${safeJSON(atRisk)}\n\n## Empresas sanas (contexto)\n${safeJSON(healthy)}\n\n`
        : `## Perfil de empresas clave\n${safeJSON(healthy)}\n\n`;
    }
  }

  switch (domain) {
    // ═══════════════════════════════════════════════════════════════
    // NEW: 7 DIRECTORS
    // ═══════════════════════════════════════════════════════════════
    case "comercial": {
      const [reorderRisk, top, margins, concentration, recentOrders, crmLeads, clientThreads, clientOverdue, atRiskContacts, ltvChurning, rfmAtRisk] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, last_order_date, revenue_share_pct, tier, overdue_amount, max_days_overdue").gt("total_revenue", 0).order("total_revenue", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, total_order_value, gross_margin_pct").not("price_delta_pct", "is", null).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("customer_product_matrix").select("company_name, product_ref, revenue, pct_of_product_revenue, pct_of_customer_revenue").gt("pct_of_customer_revenue", 50).order("revenue", { ascending: false }).limit(15),
        sb.from("odoo_sale_orders").select("company_id, name, amount_total_mxn, date_order, salesperson_name").order("date_order", { ascending: false }).limit(10),
        sb.from("odoo_crm_leads").select("name, stage, expected_revenue, probability, assigned_user, days_open").gt("expected_revenue", 0).order("expected_revenue", { ascending: false }).limit(10),
        sb.from("threads").select("subject, last_sender, hours_without_response, company_id").eq("last_sender_type", "external").gt("hours_without_response", 24).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, overdue_amount, max_days_overdue, tier").gt("overdue_amount", 50000).order("overdue_amount", { ascending: false }).limit(10),
        sb.from("health_scores").select("contact_email, company_id, overall_score, previous_score, trend, sentiment_score, responsiveness_score, payment_compliance_score, risk_signals").gte("score_date", new Date(Date.now() - 14 * 86400_000).toISOString().split("T")[0]).lt("overall_score", 60).order("overall_score", { ascending: true }).limit(10),
        // NEW (audit 2026-04-15 sprint 2): LTV + churn risk by customer.
        // Filters to strategic/important tier customers with high churn risk
        // or negative trend — the ones whose retention actually moves revenue.
        sb.from("customer_ltv_health").select("company_name, tier, ltv_mxn, revenue_12m, revenue_3m, trend_pct_vs_prior_quarters, churn_risk_score, overdue_risk_score, overdue_mxn, last_purchase").in("tier", ["strategic", "important"]).gt("churn_risk_score", 50).order("ltv_mxn", { ascending: false }).limit(15),
        // NEW: RFM segmentation — lost/at_risk/need_attention segments with high monetary
        // Gives comercial a list of clients to prioritize outreach based on pareto value.
        sb.from("rfm_segments").select("company_name, tier, segment, recency_days, frequency, monetary_12m, avg_ticket, last_purchase, contact_priority_score").in("segment", ["cant_lose", "at_risk", "hibernating", "need_attention"]).gt("monetary_12m", 200000).order("contact_priority_score", { ascending: false }).limit(15),
      ]);
      return `${profileSection}## REORDEN VENCIDO: clientes que deberian haber comprado\n${safeJSON(reorderRisk.data)}\n## LTV & CHURN RISK (clientes estrategicos/important con riesgo alto)\n${safeJSON(ltvChurning.data)}\n## RFM SEGMENTACION: clientes cant_lose/at_risk/hibernating/need_attention\n${safeJSON(rfmAtRisk.data)}\n## CLIENTES CON CARTERA VENCIDA (riesgo de relacion)\n${safeJSON(clientOverdue.data)}\n## CONTACTOS CON HEALTH SCORE BAJO (churn risk temprano)\n${safeJSON(atRiskContacts.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA (>24h)\n${safeJSON(clientThreads.data)}\n## Pipeline CRM (oportunidades activas)\n${safeJSON(crmLeads.data)}\n## Top clientes (tendencia + cartera)\n${safeJSON(top.data)}\n## Ordenes recientes\n${safeJSON(recentOrders.data)}\n## Margenes por producto+cliente\n${safeJSON(margins.data)}\n## Concentracion >50% en 1 producto\n${safeJSON(concentration.data)}`;
    }
    case "financiero": {
      const modes = directorConfig?.mode_rotation?.length
        ? directorConfig.mode_rotation
        : ["operativo", "estrategico"];
      const mode = agentId != null ? await advanceMode(sb, agentId, modes) : "operativo";
      if (mode === "estrategico") {
        return buildFinancieroContextEstrategico(sb, profileSection);
      }
      return buildFinancieroContextOperativo(sb, profileSection);
    }
    case "compliance": {
      // Fase 6: mismo patrón que financiero (modo rotativo operativo/estrategico).
      const modes = directorConfig?.mode_rotation?.length
        ? directorConfig.mode_rotation
        : ["operativo", "estrategico"];
      const mode = agentId != null ? await advanceMode(sb, agentId, modes) : "operativo";
      if (mode === "estrategico") {
        return buildComplianceContextEstrategico(sb, profileSection);
      }
      return buildComplianceContextOperativo(sb, profileSection);
    }
    case "operaciones_dir": {
      const [deliveries, orderpoints, deadStock, products, pendingPOs, pendingDeliveries, productionDelays, otdHistory, slowMoving] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date, origin").eq("is_late", true).not("state", "in", '("done","cancel")').gte("scheduled_date", new Date(Date.now() - 90 * 86400_000).toISOString().split("T")[0]).order("scheduled_date", { ascending: true }).limit(15),
        sb.from("odoo_orderpoints").select("product_name, qty_on_hand, product_min_qty, qty_forecast, warehouse_name").order("qty_on_hand", { ascending: true }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers").order("inventory_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, available_qty, reorder_min, standard_price").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(15),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total_mxn, date_order, buyer_name").eq("state", "purchase").order("date_order", { ascending: false }).limit(10),
        sb.from("odoo_deliveries").select("company_id, name, state, scheduled_date, origin").not("state", "in", '("done","cancel")').order("scheduled_date", { ascending: true }).limit(15),
        // NEW (audit 2026-04-15 sprint 2): production with customer context.
        // Replaces raw odoo_manufacturing reads with production_delays view
        // which joins MO → SO → customer (so the director knows which client
        // is affected by each late/underproduced MRP order).
        sb.from("production_delays").select("mo_name, product_name, qty_planned, qty_produced, state, date_start, assigned_user, customer_name, salesperson_name, so_amount_mxn, so_commitment_date, is_overdue, is_underproduced, days_late").or("is_overdue.eq.true,is_underproduced.eq.true").order("days_late", { ascending: false, nullsFirst: false }).limit(20),
        // NEW: On-Time Delivery trend by week (last 8 weeks) — pattern detection
        sb.from("ops_delivery_health_weekly").select("week_start, total_completed, on_time, late, otd_pct, avg_lead_days").order("week_start", { ascending: false }).limit(8),
        // NEW: Slow-moving inventory — high stock value but low/no velocity.
        // Complements dead_stock_analysis which focuses on zero-velocity only.
        sb.from("inventory_velocity").select("product_ref, product_name, stock_qty, stock_value, qty_sold_90d, customers_12m, days_of_stock, reorder_status").gt("stock_value", 50000).in("reorder_status", ["slow", "overstock", "dead"]).order("stock_value", { ascending: false }).limit(15),
      ]);
      return `${profileSection}## ENTREGAS ATRASADAS (${(deliveries.data ?? []).length})\n${safeJSON(deliveries.data)}\n## TODAS las entregas pendientes\n${safeJSON(pendingDeliveries.data)}\n## COMPRAS PENDIENTES (material en camino)\n${safeJSON(pendingPOs.data)}\n## PRODUCCION CON PROBLEMA (atrasadas o subproducidas, con cliente afectado)\n${safeJSON(productionDelays.data)}\n## TENDENCIA OTD SEMANAL (ultimas 8 semanas)\n${safeJSON(otdHistory.data)}\n## INVENTARIO LENTO/SOBRESTOCK (stock value >$50K, velocidad baja)\n${safeJSON(slowMoving.data)}\n## Orderpoints: stock bajo\n${safeJSON(orderpoints.data)}\n## Inventario critico (stock < reorder)\n${safeJSON(products.data)}\n## INVENTARIO MUERTO (sin venta >60d)\n${safeJSON(deadStock.data)}`;
    }
    case "compras": {
      const [singleSource, supplierDep, recentPOs, priceChanges, priceAnomalies, weOweSuppliers, supplierThreads, supplierOverpaid] = await Promise.all([
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(15),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases, last_purchase").order("purchase_value", { ascending: false }).limit(20),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total_mxn, state, date_order, buyer_name").order("date_order", { ascending: false }).limit(15),
        sb.from("odoo_order_lines").select("company_id, product_ref, product_name, price_unit, subtotal_mxn, order_date").eq("order_type", "purchase").order("order_date", { ascending: false }).limit(20),
        sb.from("purchase_price_intelligence").select("product_ref, product_name, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, price_change_pct, qty_vs_avg_pct, avg_qty, last_qty, total_purchases, total_spent, price_flag, qty_flag, last_order_name").in("price_flag", ["price_above_avg", "price_below_avg"]).order("total_spent", { ascending: false }).limit(25),
        sb.from("odoo_invoices").select("company_id, name, amount_total_mxn, amount_residual_mxn, days_overdue, due_date").eq("move_type", "in_invoice").in("payment_state", ["not_paid", "partial"]).order("amount_residual_mxn", { ascending: false }).limit(15),
        sb.from("threads").select("subject, last_sender, hours_without_response, company_id").gt("hours_without_response", 48).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
        // NEW (audit 2026-04-15 sprint 2): supplier price index — per-month deltas
        // vs market benchmark. Surfaces suppliers we overpaid in the last 90 days
        // with concrete MXN impact (overpaid_mxn). Unlike purchase_price_intelligence
        // which compares against our own historical avg, this compares against
        // the market (benchmark_price across all suppliers in the same month).
        sb.from("supplier_price_index").select("product_ref, product_name, supplier_name, month, supplier_avg_price, benchmark_price, price_index, overpaid_mxn, supplier_spend, last_po_name, last_po_date, price_flag").eq("price_flag", "overpaid").gte("month", new Date(Date.now() - 90 * 86400_000).toISOString().split("T")[0]).order("overpaid_mxn", { ascending: false }).limit(15),
      ]);
      const aboveAvg = ((priceAnomalies.data ?? []) as Record<string, unknown>[]).filter(r => r.price_flag === "price_above_avg");
      const belowAvg = ((priceAnomalies.data ?? []) as Record<string, unknown>[]).filter(r => r.price_flag === "price_below_avg");
      return `${profileSection}## SOBREPAGO vs BENCHMARK DE MERCADO (ultimos 90d, con MXN perdidos)\n${safeJSON(supplierOverpaid.data)}\n## ALERTA PRECIOS: comprando MAS CARO que el promedio historico\n${safeJSON(aboveAvg.slice(0, 15))}\n## Comprando MAS BARATO que el promedio (posibles ahorros logrados)\n${safeJSON(belowAvg.slice(0, 10))}\n## FACTURAS PROVEEDOR PENDIENTES (lo que debemos)\n${safeJSON(weOweSuppliers.data)}\n## EMAILS CON PROVEEDORES SIN RESPUESTA >48h\n${safeJSON(supplierThreads.data)}\n## PROVEEDOR UNICO: materiales con 1 solo proveedor\n${safeJSON(singleSource.data)}\n## Dependencia de proveedores por producto\n${safeJSON(supplierDep.data)}\n## OC recientes\n${safeJSON(recentPOs.data)}\n## Lineas de compra (precios)\n${safeJSON(priceChanges.data)}`;
    }
    case "riesgo_dir": {
      const [narrativesRisk, payRisk, singleSource, churning, trends, unanswered, topClients, supplierWeOwe, supplierConcentration] = await Promise.all([
        sb.from("company_narrative").select("canonical_name, tier, total_revenue, revenue_90d, trend_pct, overdue_amount, late_deliveries, complaints, recent_complaints, risk_signal, salespeople").not("risk_signal", "is", null).order("total_revenue", { ascending: false }).limit(15),
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"]).order("total_pending", { ascending: false }).limit(10),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, trend_pct, tier").in("tier", ["strategic", "important"]).lt("trend_pct", -30).limit(10),
        sb.from("weekly_trends").select("company_name, tier, overdue_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(10),
        sb.from("threads").select("subject, last_sender, hours_without_response, account").eq("last_sender_type", "external").gt("hours_without_response", 72).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_share_pct, tier, overdue_amount").order("total_revenue", { ascending: false }).limit(10),
        sb.from("accounting_anomalies").select("anomaly_type, severity, description, company_name, amount").eq("anomaly_type", "supplier_overdue").order("amount", { ascending: false }).limit(10),
        // NEW (audit 2026-04-15 sprint 2): supplier concentration index (Herfindahl).
        // Products where 1 supplier holds >60% share and total spend is material.
        // Catches strategic supply-chain risks before they become crises.
        sb.from("supplier_concentration_herfindahl").select("product_ref, product_name, supplier_count, top_supplier_share_pct, top_supplier_name, total_spent_12m, concentration_level").in("concentration_level", ["critico", "alto"]).gt("total_spent_12m", 100000).order("total_spent_12m", { ascending: false }).limit(15),
      ]);
      // Calculate concentration
      const topRevenue = (topClients.data ?? []) as Record<string, unknown>[];
      const totalRevenue = topRevenue.reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
      const top5Revenue = topRevenue.slice(0, 5).reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
      const concentrationPct = totalRevenue > 0 ? Math.round(top5Revenue / totalRevenue * 100) : 0;
      return `${profileSection}## CONCENTRACION DE REVENUE: top 5 clientes = ${concentrationPct}% del total\n${safeJSON(topRevenue.slice(0, 5))}\n## EMPRESAS CON SEÑALES DE ALERTA\n${safeJSON(narrativesRisk.data)}\n## RIESGO DE CADENA DE SUMINISTRO (concentracion Herfindahl en proveedores, critico/alto)\n${safeJSON(supplierConcentration.data)}\n## Empresas que exceden patron de pago\n${safeJSON(payRisk.data)}\n## PROVEEDORES A QUIENES DEBEMOS (riesgo de relacion)\n${safeJSON(supplierWeOwe.data)}\n## Tendencia semanal\n${safeJSON(trends.data)}\n## Clientes cayendo >30%\n${safeJSON(churning.data)}\n## Proveedor unico\n${safeJSON(singleSource.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA >72h\n${safeJSON(unanswered.data)}`;
    }
    case "costos": {
      const [margins, deadStock, priceErosion, topProducts, purchasePrices, productCosts, belowCostLines, bomCostCreep, customerMargins] = await Promise.all([
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, effective_cost, cost_source, bom_real_cost, cached_standard_price, gross_margin_pct, total_order_value").not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price, list_price").order("inventory_value", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, effective_cost, cost_source, gross_margin_pct, total_order_value").lt("gross_margin_pct", 15).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, standard_price, list_price").gt("stock_qty", 0).order("stock_qty", { ascending: false }).limit(15),
        sb.from("purchase_price_intelligence").select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent").eq("price_flag", "price_above_avg").order("total_spent", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, standard_price, avg_cost, list_price, stock_qty").not("avg_cost", "is", null).gt("avg_cost", 0).order("stock_qty", { ascending: false }).limit(20),
        sb.from("invoice_line_margins").select("move_name, invoice_date, company_name, product_ref, quantity, price_unit, unit_cost, gross_margin_pct, below_cost, margin_total, discount").order("margin_total", { ascending: true }).limit(15),
        // NEW (audit 2026-04-15 sprint 2): BOM divergence signal.
        // product_real_cost explodes BOMs recursively. Filter to the tractable
        // range (20% to 200% above cached) — outside this band is usually a
        // data bug, not a business signal. Also exclude products with missing
        // component costs (false alarms).
        sb.from("product_real_cost").select("product_ref, product_name, material_cost_total, cached_standard_price, delta_vs_cached_pct, raw_components_count, has_multiple_boms").eq("has_missing_costs", false).gte("delta_vs_cached_pct", 20).lte("delta_vs_cached_pct", 200).order("delta_vs_cached_pct", { ascending: false }).limit(15),
        // NEW: Customer-level margin aggregate — who's making us money, who's not
        sb.from("customer_margin_analysis").select("company_name, distinct_products, total_revenue, total_margin, margin_pct, revenue_12m, margin_pct_12m, lines_without_cost").gt("revenue_12m", 500000).order("margin_pct_12m", { ascending: true, nullsFirst: false }).limit(20),
      ]);
      return `${profileSection}## VENTAS BAJO COSTO / MARGEN <15% (eventos puntuales, ultimos 90d)\n${safeJSON(belowCostLines.data)}\n## BOM COST CREEP (costo real > cached 20-200%: productos con costo desactualizado)\n${safeJSON(bomCostCreep.data)}\n## MARGEN POR CLIENTE (12m, ordenado por margen bajo)\n${safeJSON(customerMargins.data)}\n## Margenes por producto+cliente (precio venta vs costo)\n${safeJSON(margins.data)}\n## ALERTA: productos con margen <15%\n${safeJSON(priceErosion.data)}\n## COMPRANDO MAS CARO que promedio (impacto en costos)\n${safeJSON(purchasePrices.data)}\n## Productos con costo promedio real (avg_cost de Odoo)\n${safeJSON(productCosts.data)}\n## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}\n## Productos con mas stock\n${safeJSON(topProducts.data)}`;
    }
    case "equipo_dir": {
      const [reorderByVendor, activities, employees, stalledThreads, salesByPerson, overdueByPerson] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, reorder_status, days_overdue_reorder, avg_order_value, salesperson_name, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).not("salesperson_name", "is", null).order("total_revenue", { ascending: false }).limit(30),
        sb.from("odoo_activities").select("assigned_to, activity_type, is_overdue, summary").eq("is_overdue", true).order("assigned_to").limit(30),
        sb.from("odoo_users").select("name, email, department, pending_activities_count, overdue_activities_count").order("overdue_activities_count", { ascending: false }).limit(20),
        sb.from("threads").select("subject, last_sender, hours_without_response, account, company_id").eq("last_sender_type", "external").gt("hours_without_response", 48).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(15),
        // NEW: Active orders per salesperson (workload)
        sb.from("odoo_sale_orders").select("salesperson_name, company_id, amount_total_mxn").eq("state", "sale").order("amount_total_mxn", { ascending: false }).limit(50),
        // NEW: Overdue amounts grouped by salesperson (revenue at risk)
        sb.from("company_profile").select("name, total_revenue, overdue_amount, tier").gt("overdue_amount", 10000).order("overdue_amount", { ascending: false }).limit(20),
      ]);
      // Group reorder risk by salesperson
      const vendorRisk: Record<string, { clients: number; revenue: number; companies: string[] }> = {};
      for (const r of (reorderByVendor.data ?? []) as Record<string, unknown>[]) {
        const name = String(r.salesperson_name);
        if (!vendorRisk[name]) vendorRisk[name] = { clients: 0, revenue: 0, companies: [] };
        vendorRisk[name].clients++;
        vendorRisk[name].revenue += Number(r.total_revenue ?? 0);
        vendorRisk[name].companies.push(`${r.company_name} (${r.reorder_status})`);
      }
      const vendorSummary = Object.entries(vendorRisk)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, d]) => `${name}: ${d.clients} clientes en riesgo ($${Math.round(d.revenue/1000)}K revenue) — ${d.companies.slice(0, 3).join(", ")}`);

      // Group active orders by salesperson for workload view
      const workload: Record<string, { orders: number; totalValue: number }> = {};
      for (const o of (salesByPerson.data ?? []) as Record<string, unknown>[]) {
        const name = String(o.salesperson_name ?? "Sin asignar");
        if (!workload[name]) workload[name] = { orders: 0, totalValue: 0 };
        workload[name].orders++;
        workload[name].totalValue += Number(o.amount_total_mxn ?? 0);
      }
      const workloadSummary = Object.entries(workload)
        .sort((a, b) => b[1].totalValue - a[1].totalValue)
        .map(([name, d]) => `${name}: ${d.orders} ordenes abiertas ($${Math.round(d.totalValue/1000)}K)`);

      return `${profileSection}## CARGA DE TRABAJO POR VENDEDOR (ordenes abiertas)\n${workloadSummary.join("\n")}\n\n## CARTERA VENCIDA POR CLIENTE (responsabilidad de cobro)\n${safeJSON(overdueByPerson.data)}\n\n## EMAILS SIN RESPUESTA >48h (clientes esperando)\n${safeJSON(stalledThreads.data)}\n\n## VENDEDORES CON CLIENTES EN RIESGO (agrupado)\n${vendorSummary.join("\n")}\n\n## Detalle por cliente\n${safeJSON(reorderByVendor.data)}\n## Empleados: actividades vencidas\n${safeJSON(employees.data)}\n## Actividades vencidas detalle\n${safeJSON(activities.data)}`;
    }
    // ═══════════════════════════════════════════════════════════════
    // Legacy `sales / finance / operations / relationships / risk / growth /
    // suppliers / predictive / data_quality / cleanup / meta / odoo` case
    // branches were removed on 2026-04-15. Those domains belonged to the
    // pre-April-5 agent roster; all 11 are now is_active=false in ai_agents
    // and unreachable from the orchestrator (which filters is_active=true)
    // and cron (which filters analysis_schedule!='manual'). If you ever
    // re-activate one of them, add its domain to this switch first.
    // ═══════════════════════════════════════════════════════════════
    default: return "";
  }
}

