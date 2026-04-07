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

export const maxDuration = 300;

/** Max chars for the context sent to Claude (~15K tokens) */
const MAX_CONTEXT_CHARS = 60_000;

/** Default confidence threshold — raised from 0.65 to prevent noise */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.80;

/** Max insights per agent per run — prevents flooding the inbox */
const MAX_INSIGHTS_PER_RUN = 3;

/** Old agents that should NOT generate insights (deactivated but kept for safety) */
const SILENT_AGENTS = new Set(["meta", "cleanup", "data_quality", "odoo"]);

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase = createClient(url, key);
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
    const sortedAgents = [...agents].sort((a, b) => {
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
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      );
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
    const context = await buildAgentContext(supabase, agent.domain);

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
            content: buildAgentPrompt(context, memoryText, confidenceThreshold),
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
      // Check ALL active insights (not just this agent's) to prevent cross-agent dupes
      const { data: existing } = await supabase
        .from("agent_insights").select("title, company_id, category")
        .in("state", ["new", "seen"])
        .order("created_at", { ascending: false }).limit(200);

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
          const { data: co } = await supabase.from("companies").select("id")
            .ilike("canonical_name", companyName).limit(1).single();
          if (co && existingCompanyCat.has(`${co.id}:${category}`)) {
            duplicatesSkipped++;
            continue;
          }
        }

        existingTitles.add(norm);
        if (theme) existingThemes.add(theme);
        // Track for cross-director dedup within this run
        if (companyName && companyName !== "null") {
          const { data: co2 } = await supabase.from("companies").select("id")
            .ilike("canonical_name", companyName).limit(1).single();
          if (co2) existingCompanyCat.add(`${co2.id}:${category}`);
        }
        filteredInsights.push(insight);
      }
    }

    // Enforce max insights per run
    const cappedInsights = filteredInsights.slice(0, MAX_INSIGHTS_PER_RUN);
    duplicatesSkipped += filteredInsights.length - cappedInsights.length;

    // Save insights
    if (cappedInsights.length > 0) {
      const rows = [];
      for (const i of cappedInsights) {
        let companyId: number | null = null;
        if (i.company_name) {
          const { data: co } = await supabase.from("companies").select("id")
            .ilike("canonical_name", String(i.company_name).trim()).limit(1).single();
          if (co) companyId = co.id;
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

        // Build recommendation from actions (backward compat) or use legacy field
        const actions = Array.isArray(i.actions) ? i.actions : [];
        const recommendation = actions.length > 0
          ? actions.map((a: { description?: string; assignee_name?: string }) =>
              `${a.assignee_name ?? "?"}: ${a.description ?? ""}`
            ).join(" | ")
          : (i.recommendation ? String(i.recommendation) : null);

        // Pick first action's assignee as the insight's primary assignee
        const primaryAction = actions[0] as { assignee_name?: string; assignee_role?: string } | undefined;

        rows.push({
          agent_id: agent.id, run_id: runId,
          insight_type: String(i.insight_type || "recommendation"),
          category: normalizeCategory(String(i.category || agent.domain)),
          severity: String(i.severity || "medium"),
          title: String(i.title || ""), description: String(i.description || ""),
          evidence: i.evidence || [],
          recommendation,
          confidence,
          business_impact_estimate: i.business_impact_estimate ? Number(i.business_impact_estimate) : null,
          company_id: companyId, contact_id: contactId,
          state: confidence < confidenceThreshold ? "archived" : "new",
          // Store actions in evidence for frontend access
        });
      }
      const { data: savedInsights } = await supabase.from("agent_insights").insert(rows).select("id");

      // Save action_items linked to each insight
      if (savedInsights?.length) {
        const actionRows: Record<string, unknown>[] = [];
        for (let idx = 0; idx < cappedInsights.length && idx < savedInsights.length; idx++) {
          const insight = cappedInsights[idx];
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
              company_id: rows[idx]?.company_id ?? null,
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

    const activeInsights = cappedInsights.filter(i => (Number(i.confidence) || 0.5) >= confidenceThreshold).length;
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

    // Check recent acceptance rate
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
      // Low acceptance rate → raise threshold to be more selective
      if (rate < 0.3) return 0.75;
      if (rate < 0.5) return 0.70;
      // High acceptance rate → can be slightly more permissive
      if (rate > 0.8) return 0.55;
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
const AGENT_SYSTEM_SUFFIX = `

IMPORTANTE: Eres un director virtual de Quimibond (fabricante textil mexicano de entretelas y no-tejidos).

Reglas ESTRICTAS:
1. MAXIMO 3 insights por respuesta. Si no hay nada importante, devuelve []
2. Solo genera insights que requieran ACCION CONCRETA del CEO o su equipo
3. NO repitas insights sobre el mismo tema/empresa — si otro director ya lo reportó en "QUE DICEN OTROS DIRECTORES", NO lo repitas
4. Cada evidencia DEBE ser un DATO VERIFICABLE con fuente. Ejemplos buenos:
   - "Factura INV/2026/03/0173 por $47,005 vencida 40 dias (proveedor: Khafitex)"
   - "Email de ventas@blantex.com.mx del 2-abr asunto 'Aumento precios abril' sin respuesta 117h"
   - "OC-06993-26: HILO POLYESTER 75/36 a $2.18 USD (promedio historico: $1.72, +26.7%)"
   Ejemplos MALOS: "hay facturas vencidas", "un email sin respuesta", "precios altos"
5. NO generes insights genericos o vagos ("mejorar comunicacion", "revisar proceso")
6. category DEBE ser exactamente uno de: cobranza, ventas, entregas, operaciones, proveedores, riesgo, equipo, datos
7. severity: solo "high" o "critical" para cosas urgentes. "medium" para lo demas. NUNCA uses "info" o "low"
8. Si un problema ya tiene solucion obvia (ej: factura ya pagada), NO lo reportes
9. business_impact_estimate debe ser en MXN cuando sea posible calcular
10. Para productos, SIEMPRE usa product_ref (referencia interna, ej: WM4032OW152), NO el nombre largo
11. IGNORA empresas con nombre "quimibond" o "productora de no tejidos" — son la propia empresa
12. Si ves margenes de -80% a -95% o precios de venta que son 3x+ MENORES que el costo, es casi seguro error de unidades (costo por kg vs precio por metro). NO los reportes. Si la diferencia es >3x entre costo y precio, IGNORALO completamente
13. Si ves un problema que OTRO director ya reporto (ver seccion "QUE DICEN OTROS DIRECTORES"), NO generes un insight duplicado — devuelve [] en su lugar
14. PROHIBIDO generar insights sobre el SISTEMA o los AGENTES. NO hables de: tasas de aceptacion, calibracion, subactivacion, validacion estadistica, falsa confianza, sesgo, volumen de interacciones. Esos son problemas INTERNOS que el CEO no debe ver. Si quieres mejorar el sistema, usa el campo "evidence" para documentar datos faltantes — pero el TITULO del insight debe ser sobre el NEGOCIO, no sobre los agentes
13. NO reportes datos viejos (entregas de >6 meses, ordenes de >1 año)
14. Si otro director ya reporto el mismo tema (ver seccion "QUE DICEN OTROS DIRECTORES"), NO lo repitas — en su lugar, agrega contexto nuevo que el otro director no tenia`;

function buildAgentPrompt(context: string, memoryText: string, threshold: number): string {
  const truncatedContext = context.length > MAX_CONTEXT_CHARS
    ? context.slice(0, MAX_CONTEXT_CHARS) + "\n\n[...datos truncados por limite de tokens]"
    : context;

  return `Analiza los datos y genera SOLO insights que requieran accion inmediata. Confianza minima: ${threshold}. MAXIMO 3 insights.

Si no hay nada urgente o nuevo, devuelve []. Es mejor devolver [] que generar ruido.

IMPORTANTE: Si otro director ya reporto algo en "QUE DICEN OTROS DIRECTORES", NO lo repitas.

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

// ── Context builders ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildAgentContext(supabase: any, domain: string): Promise<string> {
  // Load 3 cross-cutting intelligence layers (all directors get these)
  const [crossSignals, emailFacts, insightHistory, emailIntel, recentFeedback, pendingTickets, recentKGFacts] = await Promise.all([
    // What OTHER directors are saying
    supabase
      .from("cross_director_signals")
      .select("company_name, director_name, category, severity, title")
      .in("severity", ["critical", "high"])
      .limit(15),

    // Email facts per company
    supabase
      .from("company_email_intelligence")
      .select("company_name, fact_type, fact_text")
      .in("fact_type", ["complaint", "commitment", "request", "price"])
      .limit(15),

    // Companies flagged multiple times + CEO response
    supabase
      .from("company_insight_history")
      .select("company_name, total_insights_30d, times_acted, times_dismissed, directors_flagging, which_directors, categories_flagged")
      .gte("total_insights_30d", 2)
      .order("total_insights_30d", { ascending: false })
      .limit(10),

    // Domain-specific email facts
    getEmailIntelligence(supabase, domain),

    // FASE 2: CEO feedback from last 48h (immediate feedback loop)
    supabase
      .from("agent_insights")
      .select("title, state, category, severity, user_feedback")
      .in("state", ["acted_on", "dismissed"])
      .gte("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(15),

    // FASE 3: Tickets from other directors for this agent
    supabase
      .from("agent_tickets")
      .select("from_agent_id, insight_id, ticket_type, message, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10),

    // FASE 4: Recent high-confidence facts from knowledge graph
    supabase
      .from("facts")
      .select("fact_text, fact_type, confidence, fact_date")
      .gte("confidence", 0.85)
      .eq("expired", false)
      .order("fact_date", { ascending: false, nullsFirst: false })
      .limit(20),
  ]);

  const sections: string[] = [];

  // Cross-director signals: what are OTHER directors saying?
  if (crossSignals.data?.length) {
    // Group by company for readability
    const byCompany = new Map<string, string[]>();
    for (const s of crossSignals.data as Record<string, unknown>[]) {
      const co = String(s.company_name ?? "?");
      if (!byCompany.has(co)) byCompany.set(co, []);
      byCompany.get(co)!.push(`[${s.director_name}/${s.severity}] ${s.title}`);
    }
    const lines = [...byCompany.entries()].map(([co, signals]) =>
      `  ${co.toUpperCase()}:\n${signals.map(s => `    ${s}`).join("\n")}`
    );
    sections.push(`## QUE DICEN OTROS DIRECTORES (no repitas, complementa)\n${lines.join("\n")}`);
  }

  // Email intelligence: actual quotes from communications
  if (emailFacts.data?.length) {
    sections.push(`## SEÑALES DE EMAILS (citas textuales de comunicaciones)\n${
      (emailFacts.data as Record<string, unknown>[]).map(f =>
        `- [${f.fact_type}] ${f.company_name}: "${sanitizeEmailForClaude(String(f.fact_text), 200)}"`
      ).join("\n")
    }`);
  }

  // Temporal memory: companies flagged multiple times
  if (insightHistory.data?.length) {
    sections.push(`## HISTORIAL: empresas flaggeadas multiples veces (30 dias)\n${
      (insightHistory.data as Record<string, unknown>[]).map(h =>
        `- ${h.company_name}: ${h.total_insights_30d} veces (CEO actuo ${h.times_acted}, descarto ${h.times_dismissed}) — directores: ${h.which_directors}`
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

  const crossIntel = sections.length ? sections.join("\n\n") + "\n\n" : "";

  const domainData = await getDomainData(supabase, domain);
  return crossIntel + emailIntel + domainData;
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
async function getDomainData(sb: any, domain: string): Promise<string> {
  // Load company name map for resolving IDs to names in JSON output
  const { data: companyNames } = await sb.from("companies").select("id, canonical_name").limit(2000);
  _companyNameMap = new Map<number, string>();
  for (const c of companyNames ?? []) {
    if (c.id && c.canonical_name) _companyNameMap.set(c.id, c.canonical_name);
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
      const [reorderRisk, top, margins, concentration, recentOrders, crmLeads, clientThreads, clientOverdue] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, last_order_date, revenue_share_pct, tier, overdue_amount, max_days_overdue").gt("total_revenue", 0).order("total_revenue", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, total_order_value, gross_margin_pct").not("price_delta_pct", "is", null).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("customer_product_matrix").select("company_name, product_ref, revenue, pct_of_product_revenue, pct_of_customer_revenue").gt("pct_of_customer_revenue", 50).order("revenue", { ascending: false }).limit(15),
        sb.from("odoo_sale_orders").select("company_id, name, amount_total, date_order, salesperson_name").order("date_order", { ascending: false }).limit(10),
        sb.from("odoo_crm_leads").select("name, stage, expected_revenue, probability, assigned_user, days_open").gt("expected_revenue", 0).order("expected_revenue", { ascending: false }).limit(10),
        // NEW: Threads from clients waiting for Quimibond response
        sb.from("threads").select("subject, last_sender, hours_without_response, company_id").eq("last_sender_type", "external").gt("hours_without_response", 24).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
        // NEW: Top clients with overdue invoices (cross financial data)
        sb.from("company_profile").select("name, total_revenue, overdue_amount, max_days_overdue, tier").gt("overdue_amount", 50000).order("overdue_amount", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## REORDEN VENCIDO: clientes que deberian haber comprado\n${safeJSON(reorderRisk.data)}\n## CLIENTES CON CARTERA VENCIDA (riesgo de relacion)\n${safeJSON(clientOverdue.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA (>24h)\n${safeJSON(clientThreads.data)}\n## Pipeline CRM (oportunidades activas)\n${safeJSON(crmLeads.data)}\n## Top clientes (tendencia + cartera)\n${safeJSON(top.data)}\n## Ordenes recientes\n${safeJSON(recentOrders.data)}\n## Margenes por producto+cliente\n${safeJSON(margins.data)}\n## Concentracion >50% en 1 producto\n${safeJSON(concentration.data)}`;
    }
    case "financiero": {
      const [payPredictions, trends, invoices, overdue, payments, anomalies, cashflow, supplierOverdue, supplierPayments, cfoDash, plReport, bankBalances, realPayments] = await Promise.all([
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, median_days_to_pay, payment_trend, total_pending, max_days_overdue, predicted_payment_date, payment_risk").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal", "MEDIO: pasado de promedio"]).order("total_pending", { ascending: false }).limit(15),
        sb.from("weekly_trends").select("company_name, tier, overdue_now, overdue_delta, pending_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(15),
        sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue, invoice_date").eq("move_type", "out_invoice").gt("days_overdue", 0).order("days_overdue", { ascending: false }).limit(20),
        sb.from("company_profile").select("name, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_revenue, tier").gt("overdue_amount", 0).order("overdue_amount", { ascending: false }).limit(15),
        sb.from("odoo_payments").select("company_id, amount, payment_date").eq("payment_type", "inbound").order("payment_date", { ascending: false }).limit(10),
        sb.from("accounting_anomalies").select("anomaly_type, severity, description, company_name, amount").order("amount", { ascending: false }).limit(20),
        sb.from("cashflow_projection").select("flow_type, period, item_count, gross_amount, net_amount, probability").order("sort_order"),
        // Supplier invoices we owe
        sb.from("odoo_invoices").select("company_id, name, amount_total, amount_residual, days_overdue, due_date, payment_term").eq("move_type", "in_invoice").in("payment_state", ["not_paid", "partial"]).gt("days_overdue", 0).order("days_overdue", { ascending: false }).limit(15),
        // Recent payments to suppliers
        sb.from("odoo_payments").select("company_id, amount, payment_date").eq("payment_type", "outbound").order("payment_date", { ascending: false }).limit(10),
        // CFO: Executive dashboard (cash, CxC, CxP, overdue, 30d metrics)
        sb.from("cfo_dashboard").select("*").limit(1),
        // CFO: P&L by month (income, COGS, expenses, profit)
        sb.from("pl_estado_resultados").select("*").order("period", { ascending: false }).limit(6),
        // CFO: Bank balances (current cash position)
        sb.from("odoo_bank_balances").select("name, journal_type, currency, current_balance, updated_at").order("current_balance", { ascending: false }),
        // CFO: Real payments with journal/method detail
        sb.from("odoo_account_payments").select("company_id, name, payment_type, partner_type, amount, currency, date, journal_name, payment_method, state, is_reconciled").eq("state", "paid").order("date", { ascending: false }).limit(15),
      ]);
      const receivables = ((cashflow.data ?? []) as Record<string, unknown>[]).filter(r => r.flow_type === "receivable");
      const cashSummary = ((cashflow.data ?? []) as Record<string, unknown>[]).find(r => r.flow_type === "summary");
      const anomalyList = (anomalies.data ?? []) as Record<string, unknown>[];
      const duplicates = anomalyList.filter(a => a.anomaly_type === "duplicate_invoice");
      const staleReceivables = anomalyList.filter(a => a.anomaly_type === "stale_receivable");
      const creditNotes = anomalyList.filter(a => a.anomaly_type === "unusual_credit_note");
      const dash = (cfoDash.data ?? [])[0] as Record<string, unknown> | undefined;
      const totalBankBalance = ((bankBalances.data ?? []) as Record<string, unknown>[]).reduce((s, b) => s + Number(b.current_balance ?? 0), 0);
      return `${profileSection}## RESUMEN EJECUTIVO CFO\nEfectivo en banco: $${totalBankBalance.toLocaleString("en", { maximumFractionDigits: 0 })} | CxC: $${dash?.cuentas_por_cobrar ?? "?"} | CxP: $${dash?.cuentas_por_pagar ?? "?"} | Cartera vencida: $${dash?.cartera_vencida ?? "?"} | Ventas 30d: $${dash?.ventas_30d ?? "?"} | Cobros 30d: $${dash?.cobros_30d ?? "?"} | Pagos prov 30d: $${dash?.pagos_prov_30d ?? "?"} | Clientes morosos: ${dash?.clientes_morosos ?? "?"}\n## SALDOS BANCARIOS\n${safeJSON(bankBalances.data)}\n## ESTADO DE RESULTADOS (P&L mensual)\n${safeJSON(plReport.data)}\n## PAGOS REALES (con banco y metodo)\n${safeJSON(realPayments.data)}\n## FLUJO DE EFECTIVO PROYECTADO\nResumen: cobrable bruto $${cashSummary?.gross_amount ?? "?"}, neto esperado $${cashSummary?.net_amount ?? "?"} (probabilidad ${cashSummary?.probability ?? "?"}%)\n${safeJSON(receivables)}\n## ANOMALIAS CONTABLES: facturas duplicadas (${duplicates.length})\n${safeJSON(duplicates.slice(0, 10))}\n## Cartera estancada >90 dias (${staleReceivables.length})\n${safeJSON(staleReceivables.slice(0, 10))}\n## Notas de credito inusuales >$50K (${creditNotes.length})\n${safeJSON(creditNotes)}\n## FACTURAS PROVEEDOR VENCIDAS\n${safeJSON(supplierOverdue.data)}\n## PAGOS A PROVEEDORES (recientes)\n${safeJSON(supplierPayments.data)}\n## PREDICCION DE PAGO\n${safeJSON(payPredictions.data)}\n## Tendencia semanal\n${safeJSON(trends.data)}\n## Facturas vencidas (clientes)\n${safeJSON(invoices.data)}\n## Cartera vencida por empresa\n${safeJSON(overdue.data)}\n## Cobros recibidos\n${safeJSON(payments.data)}`;
    }
    case "operaciones_dir": {
      const [deliveries, orderpoints, deadStock, products, pendingPOs, pendingDeliveries] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date, origin").eq("is_late", true).not("state", "in", '("done","cancel")').gte("scheduled_date", new Date(Date.now() - 90 * 86400_000).toISOString().split("T")[0]).order("scheduled_date", { ascending: true }).limit(15),
        sb.from("odoo_orderpoints").select("product_name, qty_on_hand, product_min_qty, qty_forecast, warehouse_name").order("qty_on_hand", { ascending: true }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers").order("inventory_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, available_qty, reorder_min, standard_price").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(15),
        // NEW: Pending purchase orders (material on the way)
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total, date_order, buyer_name").eq("state", "purchase").order("date_order", { ascending: false }).limit(10),
        // NEW: All pending outgoing deliveries (not just late)
        sb.from("odoo_deliveries").select("company_id, name, state, scheduled_date, origin").not("state", "in", '("done","cancel")').order("scheduled_date", { ascending: true }).limit(15),
      ]);
      return `${profileSection}## ENTREGAS ATRASADAS (${(deliveries.data ?? []).length})\n${safeJSON(deliveries.data)}\n## TODAS las entregas pendientes\n${safeJSON(pendingDeliveries.data)}\n## COMPRAS PENDIENTES (material en camino)\n${safeJSON(pendingPOs.data)}\n## Orderpoints: stock bajo\n${safeJSON(orderpoints.data)}\n## Inventario critico (stock < reorder)\n${safeJSON(products.data)}\n## INVENTARIO MUERTO (sin venta >60d)\n${safeJSON(deadStock.data)}`;
    }
    case "compras": {
      const [singleSource, supplierDep, recentPOs, priceChanges, priceAnomalies, weOweSuppliers, supplierThreads] = await Promise.all([
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(15),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases, last_purchase").order("purchase_value", { ascending: false }).limit(20),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total, state, date_order, buyer_name").order("date_order", { ascending: false }).limit(15),
        sb.from("odoo_order_lines").select("company_id, product_ref, product_name, price_unit, subtotal, order_date").eq("order_type", "purchase").order("order_date", { ascending: false }).limit(20),
        sb.from("purchase_price_intelligence").select("product_ref, product_name, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, price_change_pct, qty_vs_avg_pct, avg_qty, last_qty, total_purchases, total_spent, price_flag, qty_flag, last_order_name").in("price_flag", ["price_above_avg", "price_below_avg"]).order("total_spent", { ascending: false }).limit(25),
        // NEW: Supplier invoices we need to pay (what we owe)
        sb.from("odoo_invoices").select("company_id, name, amount_total, amount_residual, days_overdue, due_date").eq("move_type", "in_invoice").in("payment_state", ["not_paid", "partial"]).order("amount_residual", { ascending: false }).limit(15),
        // NEW: Emails from/to suppliers without response
        sb.from("threads").select("subject, last_sender, hours_without_response, company_id").gt("hours_without_response", 48).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
      ]);
      const aboveAvg = ((priceAnomalies.data ?? []) as Record<string, unknown>[]).filter(r => r.price_flag === "price_above_avg");
      const belowAvg = ((priceAnomalies.data ?? []) as Record<string, unknown>[]).filter(r => r.price_flag === "price_below_avg");
      return `${profileSection}## ALERTA PRECIOS: comprando MAS CARO que el promedio historico\n${safeJSON(aboveAvg.slice(0, 15))}\n## Comprando MAS BARATO que el promedio (posibles ahorros logrados)\n${safeJSON(belowAvg.slice(0, 10))}\n## FACTURAS PROVEEDOR PENDIENTES (lo que debemos)\n${safeJSON(weOweSuppliers.data)}\n## EMAILS CON PROVEEDORES SIN RESPUESTA >48h\n${safeJSON(supplierThreads.data)}\n## PROVEEDOR UNICO: materiales con 1 solo proveedor\n${safeJSON(singleSource.data)}\n## Dependencia de proveedores por producto\n${safeJSON(supplierDep.data)}\n## OC recientes\n${safeJSON(recentPOs.data)}\n## Lineas de compra (precios)\n${safeJSON(priceChanges.data)}`;
    }
    case "riesgo_dir": {
      const [narrativesRisk, payRisk, singleSource, churning, trends, unanswered, topClients, supplierWeOwe] = await Promise.all([
        sb.from("company_narrative").select("canonical_name, tier, total_revenue, revenue_90d, trend_pct, overdue_amount, late_deliveries, complaints, recent_complaints, risk_signal, salespeople").not("risk_signal", "is", null).order("total_revenue", { ascending: false }).limit(15),
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"]).order("total_pending", { ascending: false }).limit(10),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, trend_pct, tier").in("tier", ["strategic", "important"]).lt("trend_pct", -30).limit(10),
        sb.from("weekly_trends").select("company_name, tier, overdue_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(10),
        sb.from("threads").select("subject, last_sender, hours_without_response, account").eq("last_sender_type", "external").gt("hours_without_response", 72).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
        // NEW: Revenue concentration — top clients as % of total
        sb.from("company_profile").select("name, total_revenue, revenue_share_pct, tier, overdue_amount").order("total_revenue", { ascending: false }).limit(10),
        // NEW: Suppliers we owe money to (relationship risk)
        sb.from("accounting_anomalies").select("anomaly_type, severity, description, company_name, amount").eq("anomaly_type", "supplier_overdue").order("amount", { ascending: false }).limit(10),
      ]);
      // Calculate concentration
      const topRevenue = (topClients.data ?? []) as Record<string, unknown>[];
      const totalRevenue = topRevenue.reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
      const top5Revenue = topRevenue.slice(0, 5).reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
      const concentrationPct = totalRevenue > 0 ? Math.round(top5Revenue / totalRevenue * 100) : 0;
      return `${profileSection}## CONCENTRACION DE REVENUE: top 5 clientes = ${concentrationPct}% del total\n${safeJSON(topRevenue.slice(0, 5))}\n## EMPRESAS CON SEÑALES DE ALERTA\n${safeJSON(narrativesRisk.data)}\n## Empresas que exceden patron de pago\n${safeJSON(payRisk.data)}\n## PROVEEDORES A QUIENES DEBEMOS (riesgo de relacion)\n${safeJSON(supplierWeOwe.data)}\n## Tendencia semanal\n${safeJSON(trends.data)}\n## Clientes cayendo >30%\n${safeJSON(churning.data)}\n## Proveedor unico\n${safeJSON(singleSource.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA >72h\n${safeJSON(unanswered.data)}`;
    }
    case "costos": {
      const [margins, deadStock, priceErosion, topProducts, purchasePrices, productCosts] = await Promise.all([
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, cost_price, gross_margin_pct, total_order_value").not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price, list_price").order("inventory_value", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, cost_price, gross_margin_pct, total_order_value").lt("gross_margin_pct", 15).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, standard_price, list_price").gt("stock_qty", 0).order("stock_qty", { ascending: false }).limit(15),
        // NEW: Purchase prices vs historical average (are we buying expensive?)
        sb.from("purchase_price_intelligence").select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent").eq("price_flag", "price_above_avg").order("total_spent", { ascending: false }).limit(15),
        // NEW: Products with avg_cost for real margin calculation
        sb.from("odoo_products").select("internal_ref, name, standard_price, avg_cost, list_price, stock_qty").not("avg_cost", "is", null).gt("avg_cost", 0).order("stock_qty", { ascending: false }).limit(20),
      ]);
      return `${profileSection}## Margenes por producto+cliente (precio venta vs costo)\n${safeJSON(margins.data)}\n## ALERTA: productos con margen <15%\n${safeJSON(priceErosion.data)}\n## COMPRANDO MAS CARO que promedio (impacto en costos)\n${safeJSON(purchasePrices.data)}\n## Productos con costo promedio real (avg_cost de Odoo)\n${safeJSON(productCosts.data)}\n## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}\n## Productos con mas stock\n${safeJSON(topProducts.data)}`;
    }
    case "equipo_dir": {
      const [reorderByVendor, activities, employees, stalledThreads, salesByPerson, overdueByPerson] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, reorder_status, days_overdue_reorder, avg_order_value, salesperson_name, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).not("salesperson_name", "is", null).order("total_revenue", { ascending: false }).limit(30),
        sb.from("odoo_activities").select("assigned_to, activity_type, is_overdue, summary").eq("is_overdue", true).order("assigned_to").limit(30),
        sb.from("odoo_users").select("name, email, department, pending_activities_count, overdue_activities_count").order("overdue_activities_count", { ascending: false }).limit(20),
        sb.from("threads").select("subject, last_sender, hours_without_response, account, company_id").eq("last_sender_type", "external").gt("hours_without_response", 48).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(15),
        // NEW: Active orders per salesperson (workload)
        sb.from("odoo_sale_orders").select("salesperson_name, company_id, amount_total").eq("state", "sale").order("amount_total", { ascending: false }).limit(50),
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
        workload[name].totalValue += Number(o.amount_total ?? 0);
      }
      const workloadSummary = Object.entries(workload)
        .sort((a, b) => b[1].totalValue - a[1].totalValue)
        .map(([name, d]) => `${name}: ${d.orders} ordenes abiertas ($${Math.round(d.totalValue/1000)}K)`);

      return `${profileSection}## CARGA DE TRABAJO POR VENDEDOR (ordenes abiertas)\n${workloadSummary.join("\n")}\n\n## CARTERA VENCIDA POR CLIENTE (responsabilidad de cobro)\n${safeJSON(overdueByPerson.data)}\n\n## EMAILS SIN RESPUESTA >48h (clientes esperando)\n${safeJSON(stalledThreads.data)}\n\n## VENDEDORES CON CLIENTES EN RIESGO (agrupado)\n${vendorSummary.join("\n")}\n\n## Detalle por cliente\n${safeJSON(reorderByVendor.data)}\n## Empleados: actividades vencidas\n${safeJSON(employees.data)}\n## Actividades vencidas detalle\n${safeJSON(activities.data)}`;
    }
    // ═══════════════════════════════════════════════════════════════
    // LEGACY: old domains (kept for backward compat, won't run)
    // ═══════════════════════════════════════════════════════════════
    case "sales": {
      const [orders, top, recentSaleOrders, margins, customerConcentration, reorderRisk] = await Promise.all([
        sb.from("odoo_order_lines").select("company_id, product_ref, product_name, subtotal, order_date").eq("order_type", "sale").order("order_date", { ascending: false }).limit(25),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, last_order_date, revenue_share_pct").gt("total_revenue", 0).order("total_revenue", { ascending: false }).limit(20),
        sb.from("odoo_sale_orders").select("company_id, name, state, amount_total, date_order, salesperson_name").order("date_order", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, total_order_value, gross_margin_pct").not("price_delta_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("customer_product_matrix").select("company_name, product_ref, revenue, pct_of_product_revenue, pct_of_customer_revenue").gt("pct_of_customer_revenue", 50).order("revenue", { ascending: false }).limit(15),
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(15),
      ]);
      return `${profileSection}## REORDEN VENCIDO: clientes que deberian haber comprado y no lo hicieron\n${safeJSON(reorderRisk.data)}\n## Ordenes recientes\n${safeJSON(recentSaleOrders.data)}\n## Top clientes (con tendencia)\n${safeJSON(top.data)}\n## Margenes por producto+cliente\n${safeJSON(margins.data)}\n## Concentracion: clientes >50% en 1 producto\n${safeJSON(customerConcentration.data)}`;
    }
    case "finance": {
      const [inv, ow, payments, trends, margins, payPredictions] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue, invoice_date").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(30),
        sb.from("company_profile").select("name, pending_amount, overdue_amount, overdue_count, overdue_30d_count, max_days_overdue, total_revenue, tier").gt("overdue_amount", 0).order("overdue_amount", { ascending: false }).limit(20),
        sb.from("odoo_payments").select("company_id, amount, payment_date, state").order("payment_date", { ascending: false }).limit(15),
        sb.from("weekly_trends").select("company_name, tier, overdue_now, overdue_delta, pending_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("company_name, product_ref, avg_order_price, avg_invoice_price, price_delta_pct").not("price_delta_pct", "is", null).gt("price_delta_pct", 10).order("price_delta_pct", { ascending: false }).limit(10),
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, median_days_to_pay, payment_trend, total_pending, max_days_overdue, predicted_payment_date, payment_risk").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal", "MEDIO: pasado de promedio"]).order("total_pending", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## PREDICCION DE PAGO: empresas fuera de patron\n${safeJSON(payPredictions.data)}\n## Tendencia semanal: que cambio vs semana pasada\n${safeJSON(trends.data)}\n## Facturas (ordenadas por dias vencidas)\n${safeJSON(inv.data)}\n## Empresas con cartera vencida\n${safeJSON(ow.data)}\n## Pagos recientes\n${safeJSON(payments.data)}\n## Productos facturados >10% arriba del precio de orden\n${safeJSON(margins.data)}`;
    }
    case "operations": {
      const [del, prod, deadStock, orderpoints] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date").order("scheduled_date", { ascending: false }).limit(25),
        sb.from("odoo_products").select("name, stock_qty, available_qty, reorder_min").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers").order("inventory_value", { ascending: false }).limit(15),
        sb.from("odoo_orderpoints").select("product_name, qty_on_hand, product_min_qty, qty_forecast").lt("qty_on_hand", 100).order("qty_on_hand", { ascending: true }).limit(15),  // orderpoints don't have product_ref yet
      ]);
      return `${profileSection}## Entregas\n${safeJSON(del.data)}\n## Inventario critico (stock < reorder min)\n${safeJSON(prod.data)}\n## DESABASTO: Orderpoints con stock bajo\n${safeJSON(orderpoints.data)}\n## INVENTARIO MUERTO: productos sin venta >60 dias con stock\n${safeJSON(deadStock.data)}`;
    }
    case "relationships": {
      const [ct, th, activities, blind] = await Promise.all([
        sb.from("contacts").select("id, name, risk_level, current_health_score, last_activity, company_id").eq("contact_type", "external").order("current_health_score", { ascending: true, nullsFirst: false }).limit(20),
        sb.from("threads").select("subject, status, hours_without_response, contact_id").in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(15),
        sb.from("odoo_activities").select("summary, activity_type, date_deadline, state, odoo_user_id").eq("state", "planned").order("date_deadline", { ascending: true }).limit(15),
        sb.from("company_profile").select("name, total_revenue, email_count, contact_count, tier").in("tier", ["strategic", "important"]).eq("email_count", 0).limit(10),
      ]);
      return `${profileSection}## Contactos con peor salud\n${safeJSON(ct.data)}\n## Threads sin respuesta\n${safeJSON(th.data)}\n## Actividades pendientes\n${safeJSON(activities.data)}\n## Clientes importantes SIN emails vinculados (relacion ciega)\n${safeJSON(blind.data)}`;
    }
    case "risk": {
      const [inv, risk, lateDeliveries, churning, trends, singleSource, payRisk] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_residual, days_overdue, invoice_date").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, overdue_amount, max_days_overdue, revenue_share_pct, risk_level, tier").in("risk_level", ["high", "critical"]).order("overdue_amount", { ascending: false }).limit(15),
        sb.from("odoo_deliveries").select("company_id, name, scheduled_date, is_late").eq("is_late", true).not("state", "in", '("done","cancel")').limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, tier").in("tier", ["strategic", "important"]).lt("trend_pct", -30).limit(10),
        sb.from("weekly_trends").select("company_name, tier, overdue_now, overdue_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(10),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(10),
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"]).order("total_pending", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## PREDICCION DE PAGO: empresas que exceden su patron historico\n${safeJSON(payRisk.data)}\n## Tendencia semanal: que empeoro esta semana\n${safeJSON(trends.data)}\n## Facturas vencidas >30 dias\n${safeJSON(inv.data)}\n## Empresas en riesgo\n${safeJSON(risk.data)}\n## Entregas atrasadas\n${safeJSON(lateDeliveries.data)}\n## Clientes importantes con caida >30%\n${safeJSON(churning.data)}\n## Proveedor unico por material\n${safeJSON(singleSource.data)}`;
    }
    case "growth": {
      const [growing, crossSell, newClients] = await Promise.all([
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, tier").gt("trend_pct", 0).in("tier", ["strategic", "important", "regular"]).order("trend_pct", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, total_orders, tier").in("tier", ["strategic", "important"]).lt("total_orders", 10).order("total_revenue", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, total_orders, last_order_date").gt("revenue_90d", 0).eq("revenue_prior_90d", 0).order("revenue_90d", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## Clientes creciendo\n${safeJSON(growing.data)}\n## Clientes grandes con pocas ordenes (oportunidad cross-sell)\n${safeJSON(crossSell.data)}\n## Clientes nuevos (compraron en ultimos 90d sin historial previo)\n${safeJSON(newClients.data)}`;
    }
    case "cleanup": {
      const c = await Promise.all([
        sb.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null),
        sb.from("emails").select("id", { count: "exact", head: true }),
        sb.from("contacts").select("id", { count: "exact", head: true }).is("name", null),
        sb.from("companies").select("id, name", { count: "exact" }).is("industry", null).not("is_customer", "is", null).limit(20),
        sb.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null),
        sb.from("odoo_invoices").select("id", { count: "exact", head: true }).is("company_id", null),
        sb.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", false),
        sb.from("agent_insights").select("id", { count: "exact", head: true }).is("company_id", null).in("state", ["new", "seen"]),
      ]);
      // Also get companies needing enrichment
      const { data: unenriched } = await sb
        .from("company_profile")
        .select("company_id, name, total_revenue, total_purchases, tier")
        .in("tier", ["strategic", "important", "key_supplier"])
        .order("total_revenue", { ascending: false })
        .limit(30);
      return `## Metricas de calidad\n- Emails sin contacto: ${c[0].count}/${c[1].count}\n- Contactos sin nombre: ${c[2].count}\n- Empresas sin industry: ${c[3].count}\n- Empresas sin entity: ${c[4].count}\n- Invoices sin company: ${c[5].count}\n- Emails sin procesar: ${c[6].count}\n- Insights huerfanos: ${c[7].count}\n\n## Empresas clave que necesitan enriquecimiento\n${safeJSON(unenriched)}`;
    }
    case "data_quality": {
      const c = await Promise.all([
        sb.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null),
        sb.from("emails").select("id", { count: "exact", head: true }),
        sb.from("contacts").select("id", { count: "exact", head: true }).is("name", null),
        sb.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null),
        sb.from("companies").select("id", { count: "exact", head: true }),
        sb.from("odoo_invoices").select("id", { count: "exact", head: true }).is("company_id", null),
        sb.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", false),
      ]);
      return `## Data Quality\n- Emails sin contacto: ${c[0].count}/${c[1].count}\n- Contactos sin nombre: ${c[2].count}\n- Empresas sin entity: ${c[3].count}/${c[4].count}\n- Invoices sin company: ${c[5].count}\n- Emails sin procesar: ${c[6].count}`;
    }
    case "meta": {
      const [r, i, mem, emp] = await Promise.all([
        sb.from("agent_runs").select("agent_id, status, insights_generated, duration_seconds").order("started_at", { ascending: false }).limit(20),
        sb.from("agent_insights").select("agent_id, severity, state, confidence, was_useful, insight_type").order("created_at", { ascending: false }).limit(40),
        sb.from("agent_memory").select("agent_id, memory_type, importance, times_used").order("updated_at", { ascending: false }).limit(20),
        sb.from("employee_metrics").select("name, department, emails_sent, emails_received, actions_assigned, actions_completed, actions_overdue, activities_overdue, contacts_managed, execution_score, overall_score").eq("period_type", "weekly").order("overall_score", { ascending: true }).limit(20),
      ]);
      return `## Rendimiento del equipo (esta semana)\n${safeJSON(emp.data)}\n## Runs recientes\n${safeJSON(r.data)}\n## Insights recientes (estado y feedback)\n${safeJSON(i.data)}\n## Memorias activas\n${safeJSON(mem.data)}`;
    }
    case "predictive": {
      const [reorder, cashFlow, trend, topAtRisk] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).order("days_overdue_reorder", { ascending: false }).limit(20),
        sb.from("cash_flow_aging").select("company_name, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, tier").limit(15),
        sb.from("monthly_revenue_trend").select("month, revenue, active_clients, mom_change_pct").limit(15),
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").eq("reorder_status", "on_track").in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## Clientes con reorden VENCIDO o en riesgo\n${safeJSON(reorder.data)}\n## Cash flow aging (cartera por antigüedad)\n${safeJSON(cashFlow.data)}\n## Tendencia mensual de revenue\n${safeJSON(trend.data)}\n## Clientes estrategicos on-track (para prediccion de reorden)\n${safeJSON(topAtRisk.data)}`;
    }
    case "suppliers": {
      const [topSuppliers, recentPOs, priceChanges, supplierDep] = await Promise.all([
        sb.from("company_profile").select("name, total_purchases, total_revenue, email_count, contact_count, tier").gt("total_purchases", 50000).order("total_purchases", { ascending: false }).limit(20),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total, state, date_order").order("date_order", { ascending: false }).limit(20),
        sb.from("odoo_order_lines").select("company_id, product_ref, product_name, subtotal, order_date").eq("order_type", "purchase").order("order_date", { ascending: false }).limit(30),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases, last_purchase").order("purchase_value", { ascending: false }).limit(20),
      ]);
      return `${profileSection}## Top proveedores (por monto de compra)\n${safeJSON(topSuppliers.data)}\n## Ordenes de compra recientes\n${safeJSON(recentPOs.data)}\n## Lineas de compra recientes\n${safeJSON(priceChanges.data)}\n## Dependencia de proveedores por producto (quién provee qué y % de concentración)\n${safeJSON(supplierDep.data)}`;
    }
    default: return "";
  }
}

/** Safe JSON stringify that handles null/undefined and limits size */
/** Company name cache — loaded once per getDomainData call */
let _companyNameMap: Map<number, string> | null = null;

function safeJSON(data: unknown): string {
  if (!data) return "[]";
  let str = JSON.stringify(data);
  // Replace company_id with company name for readability
  if (_companyNameMap && str.includes("company_id")) {
    str = str.replace(/"company_id"\s*:\s*(\d+)/g, (match, id) => {
      const name = _companyNameMap?.get(Number(id));
      return name ? `"empresa":"${name}"` : match;
    });
  }
  if (str.length > 8000) return str.slice(0, 8000) + "...truncado]";
  return str;
}
