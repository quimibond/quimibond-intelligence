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

      for (const insight of insights) {
        const norm = normalizeForDedup(String(insight.title || ""));
        if (existingTitles.has(norm)) { duplicatesSkipped++; continue; }

        // Check if same company+category already has an active insight
        const companyName = String(insight.company_name || "").trim().toLowerCase();
        const category = normalizeCategory(String(insight.category || agent.domain));
        if (companyName && companyName !== "null") {
          // We'll resolve company_id later, but for now check by normalized title similarity
          const titleWords = norm.split(" ").filter(w => w.length > 3);
          const hasSimilar = [...existingTitles].some(existing => {
            const overlap = titleWords.filter(w => existing.includes(w)).length;
            return overlap >= Math.min(3, titleWords.length * 0.5);
          });
          if (hasSimilar) { duplicatesSkipped++; continue; }
        }

        existingTitles.add(norm);
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

        rows.push({
          agent_id: agent.id, run_id: runId,
          insight_type: String(i.insight_type || "recommendation"),
          category: normalizeCategory(String(i.category || agent.domain)),
          severity: String(i.severity || "medium"),
          title: String(i.title || ""), description: String(i.description || ""),
          evidence: i.evidence || [],
          recommendation: i.recommendation ? String(i.recommendation) : null,
          confidence,
          business_impact_estimate: i.business_impact_estimate ? Number(i.business_impact_estimate) : null,
          company_id: companyId, contact_id: contactId,
          state: confidence < confidenceThreshold ? "archived" : "new",
        });
      }
      await supabase.from("agent_insights").insert(rows);
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
  /sesgo\s+(sistem|hacia)/i,
  /calibraci[oó]n\s+(de|imposible)/i,
  /director\s+\w+\s+(ausente|fantasma)/i,
  /frecuencia\s+de\s+activaci/i,
  /aceptaci[oó]n/i,
  /diversificar\s+hacia/i,
  /sin\s+datos\s+(de|para)\s+(clientes|cartera|productos|empresas)/i,
  /agentes?\s+con\s+\d+%/i,
  /validaci[oó]n\s+prematura/i,
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

// ── Structured prompt for agents ────────────────────────────────────────
const AGENT_SYSTEM_SUFFIX = `

IMPORTANTE: Eres un director virtual de Quimibond (fabricante textil mexicano de entretelas y no-tejidos).

Reglas ESTRICTAS:
1. MAXIMO 3 insights por respuesta. Si no hay nada importante, devuelve []
2. Solo genera insights que requieran ACCION CONCRETA del CEO o su equipo
3. NO repitas insights sobre el mismo tema/empresa — si otro director ya lo reportó en "QUE DICEN OTROS DIRECTORES", NO lo repitas
4. Cada insight DEBE tener evidencia CONCRETA: numeros, fechas, nombres, montos
5. NO generes insights genericos o vagos ("mejorar comunicacion", "revisar proceso")
6. category DEBE ser exactamente uno de: cobranza, ventas, entregas, operaciones, proveedores, riesgo, equipo, datos
7. severity: solo "high" o "critical" para cosas urgentes. "medium" para lo demas. NUNCA uses "info" o "low"
8. Si un problema ya tiene solucion obvia (ej: factura ya pagada), NO lo reportes
9. business_impact_estimate debe ser en MXN cuando sea posible calcular
10. Para productos, SIEMPRE usa product_ref (referencia interna, ej: WM4032OW152), NO el nombre largo
11. IGNORA empresas con nombre "quimibond" o "productora de no tejidos" — son la propia empresa
12. Si ves margenes de -80% a -95%, probablemente es error de unidades (costo por kg vs precio por metro). NO los reportes como perdidas reales sin verificar
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
  "recommendation": "string — QUE hacer especificamente (no 'revisar' sino 'llamar a X para cobrar Y')",
  "business_impact_estimate": number|null (MXN),
  "evidence": ["dato concreto: cifra, fecha, o nombre"],
  "company_name": "string exacto como aparece en datos|null",
  "contact_email": "string|null"
}`;
}

// ── Context builders ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildAgentContext(supabase: any, domain: string): Promise<string> {
  // Load 3 cross-cutting intelligence layers (all directors get these)
  const [crossSignals, emailFacts, insightHistory, emailIntel] = await Promise.all([
    // Gap 1: What OTHER directors are saying (cross-director signals)
    supabase
      .from("cross_director_signals")
      .select("company_name, director_name, category, severity, title")
      .in("severity", ["critical", "high"])
      .limit(15),

    // Gap 2: Actual email facts per company (complaints, commitments, requests)
    supabase
      .from("company_email_intelligence")
      .select("company_name, fact_type, fact_text")
      .in("fact_type", ["complaint", "commitment", "request", "price"])
      .limit(15),

    // Gap 5: How many times each company was flagged + CEO response
    supabase
      .from("company_insight_history")
      .select("company_name, total_insights_30d, times_acted, times_dismissed, directors_flagging, which_directors, categories_flagged")
      .gte("total_insights_30d", 2)
      .order("total_insights_30d", { ascending: false })
      .limit(10),

    // Existing: domain-specific email facts
    getEmailIntelligence(supabase, domain),
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
      const [reorderRisk, top, margins, concentration, recentOrders, crmLeads] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, last_order_date, revenue_share_pct, tier").gt("total_revenue", 0).order("total_revenue", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, total_order_value, gross_margin_pct").not("price_delta_pct", "is", null).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("customer_product_matrix").select("company_name, product_ref, revenue, pct_of_product_revenue, pct_of_customer_revenue").gt("pct_of_customer_revenue", 50).order("revenue", { ascending: false }).limit(15),
        sb.from("odoo_sale_orders").select("company_id, name, amount_total, date_order, salesperson_name").order("date_order", { ascending: false }).limit(10),
        sb.from("odoo_crm_leads").select("name, stage, expected_revenue, probability, assigned_user, days_open").gt("expected_revenue", 0).order("expected_revenue", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## REORDEN VENCIDO: clientes que deberian haber comprado\n${safeJSON(reorderRisk.data)}\n## Pipeline CRM (oportunidades activas)\n${safeJSON(crmLeads.data)}\n## Top clientes (tendencia)\n${safeJSON(top.data)}\n## Ordenes recientes\n${safeJSON(recentOrders.data)}\n## Margenes por producto+cliente\n${safeJSON(margins.data)}\n## Concentracion >50% en 1 producto\n${safeJSON(concentration.data)}`;
    }
    case "financiero": {
      const [payPredictions, trends, invoices, overdue, payments] = await Promise.all([
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, median_days_to_pay, payment_trend, total_pending, max_days_overdue, predicted_payment_date, payment_risk").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal", "MEDIO: pasado de promedio"]).order("total_pending", { ascending: false }).limit(15),
        sb.from("weekly_trends").select("company_name, tier, overdue_now, overdue_delta, pending_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(15),
        sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue, invoice_date").eq("move_type", "out_invoice").gt("days_overdue", 0).order("days_overdue", { ascending: false }).limit(20),
        sb.from("company_profile").select("name, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_revenue, tier").gt("overdue_amount", 0).order("overdue_amount", { ascending: false }).limit(15),
        sb.from("odoo_payments").select("company_id, amount, payment_date").order("payment_date", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## PREDICCION DE PAGO: empresas fuera de patron\n${safeJSON(payPredictions.data)}\n## Tendencia semanal\n${safeJSON(trends.data)}\n## Facturas vencidas\n${safeJSON(invoices.data)}\n## Cartera vencida por empresa\n${safeJSON(overdue.data)}\n## Pagos recientes\n${safeJSON(payments.data)}`;
    }
    case "operaciones_dir": {
      const [deliveries, orderpoints, deadStock, products] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date, origin").eq("is_late", true).not("state", "in", '("done","cancel")').gte("scheduled_date", new Date(Date.now() - 90 * 86400_000).toISOString().split("T")[0]).order("scheduled_date", { ascending: true }).limit(15),
        sb.from("odoo_orderpoints").select("product_name, qty_on_hand, product_min_qty, qty_forecast, warehouse_name").order("qty_on_hand", { ascending: true }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers").order("inventory_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, available_qty, reorder_min, standard_price").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(15),
      ]);
      return `${profileSection}## ENTREGAS ATRASADAS\n${safeJSON(deliveries.data)}\n## Orderpoints: stock bajo\n${safeJSON(orderpoints.data)}\n## Inventario critico (stock < reorder)\n${safeJSON(products.data)}\n## INVENTARIO MUERTO (sin venta >60d)\n${safeJSON(deadStock.data)}`;
    }
    case "compras": {
      const [singleSource, supplierDep, recentPOs, priceChanges] = await Promise.all([
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(15),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases, last_purchase").order("purchase_value", { ascending: false }).limit(20),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total, state, date_order, buyer_name").order("date_order", { ascending: false }).limit(15),
        sb.from("odoo_order_lines").select("company_id, product_ref, product_name, price_unit, subtotal, order_date").eq("order_type", "purchase").order("order_date", { ascending: false }).limit(20),
      ]);
      return `${profileSection}## PROVEEDOR UNICO: materiales con 1 solo proveedor\n${safeJSON(singleSource.data)}\n## Dependencia de proveedores por producto\n${safeJSON(supplierDep.data)}\n## OC recientes\n${safeJSON(recentPOs.data)}\n## Lineas de compra (precios)\n${safeJSON(priceChanges.data)}`;
    }
    case "riesgo_dir": {
      const [narrativesRisk, payRisk, singleSource, churning, trends, unanswered] = await Promise.all([
        sb.from("company_narrative").select("canonical_name, tier, total_revenue, revenue_90d, trend_pct, overdue_amount, late_deliveries, complaints, recent_complaints, risk_signal, salespeople").not("risk_signal", "is", null).order("total_revenue", { ascending: false }).limit(15),
        sb.from("payment_predictions").select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending").in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"]).order("total_pending", { ascending: false }).limit(10),
        sb.from("supplier_product_matrix").select("supplier_name, product_ref, purchase_value, total_suppliers_for_product").eq("total_suppliers_for_product", 1).order("purchase_value", { ascending: false }).limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, trend_pct, tier").in("tier", ["strategic", "important"]).lt("trend_pct", -30).limit(10),
        sb.from("weekly_trends").select("company_name, tier, overdue_delta, late_delta, trend_signal").not("trend_signal", "is", null).order("overdue_delta", { ascending: false }).limit(10),
        sb.from("threads").select("subject, last_sender, hours_without_response, account").eq("last_sender_type", "external").gt("hours_without_response", 72).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## EMPRESAS CON SEÑALES DE ALERTA\n${safeJSON(narrativesRisk.data)}\n## Empresas que exceden patron de pago\n${safeJSON(payRisk.data)}\n## Tendencia semanal\n${safeJSON(trends.data)}\n## Clientes cayendo >30%\n${safeJSON(churning.data)}\n## Proveedor unico\n${safeJSON(singleSource.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA >72h\n${safeJSON(unanswered.data)}`;
    }
    case "costos": {
      const [margins, deadStock, priceErosion, topProducts] = await Promise.all([
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, cost_price, gross_margin_pct, total_order_value").not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price, list_price").order("inventory_value", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, cost_price, gross_margin_pct, total_order_value").lt("gross_margin_pct", 15).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, standard_price, list_price").gt("stock_qty", 0).order("stock_qty", { ascending: false }).limit(15),
      ]);
      return `${profileSection}## Margenes por producto+cliente (precio venta vs costo)\n${safeJSON(margins.data)}\n## ALERTA: productos con margen <15%\n${safeJSON(priceErosion.data)}\n## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}\n## Productos con mas stock\n${safeJSON(topProducts.data)}`;
    }
    case "equipo_dir": {
      const [reorderByVendor, activities, employees, stalledThreads] = await Promise.all([
        sb.from("client_reorder_predictions").select("company_name, tier, reorder_status, days_overdue_reorder, avg_order_value, salesperson_name, total_revenue").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).not("salesperson_name", "is", null).order("total_revenue", { ascending: false }).limit(30),
        sb.from("odoo_activities").select("assigned_to, activity_type, is_overdue, summary").eq("is_overdue", true).order("assigned_to").limit(30),
        sb.from("odoo_users").select("name, email, department, pending_activities_count, overdue_activities_count").order("overdue_activities_count", { ascending: false }).limit(20),
        // Threads where external client wrote and nobody from Quimibond responded in 48h+
        sb.from("threads").select("subject, last_sender, hours_without_response, account, company_id").eq("last_sender_type", "external").gt("hours_without_response", 48).in("status", ["needs_response", "stalled"]).order("hours_without_response", { ascending: false }).limit(15),
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

      return `${profileSection}## EMAILS SIN RESPUESTA >48h (clientes esperando)\n${safeJSON(stalledThreads.data)}\n\n## VENDEDORES CON CLIENTES EN RIESGO (agrupado)\n${vendorSummary.join("\n")}\n\n## Detalle por cliente\n${safeJSON(reorderByVendor.data)}\n## Empleados: actividades vencidas\n${safeJSON(employees.data)}\n## Actividades vencidas detalle\n${safeJSON(activities.data)}`;
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
function safeJSON(data: unknown): string {
  if (!data) return "[]";
  const str = JSON.stringify(data);
  if (str.length > 8000) return str.slice(0, 8000) + "...truncado]";
  return str;
}
