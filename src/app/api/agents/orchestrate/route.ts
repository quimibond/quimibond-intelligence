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

export const maxDuration = 300;

/** Max chars for the context sent to Claude (~15K tokens) */
const MAX_CONTEXT_CHARS = 60_000;

/** Default confidence threshold — overridden per-agent by learning */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;

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

    // Pick up to 3 agents that need to run (least recently ran first)
    const MAX_PARALLEL = 3;
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
  const { data: run } = await supabase
    .from("agent_runs")
    .insert({ agent_id: agent.id, status: "running", trigger_type: "orchestrator" })
    .select("id")
    .single();
  const runId = run?.id;
  const agentStart = Date.now();

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

    // Deduplicate
    let duplicatesSkipped = 0;
    const filteredInsights = [];
    if (insights.length > 0) {
      const { data: existing } = await supabase
        .from("agent_insights").select("title")
        .eq("agent_id", agent.id).in("state", ["new", "seen"])
        .order("created_at", { ascending: false }).limit(50);
      const existingTitles = new Set((existing ?? []).map((i: { title: string }) => normalizeForDedup(i.title)));
      for (const insight of insights) {
        const norm = normalizeForDedup(String(insight.title || ""));
        if (existingTitles.has(norm)) { duplicatesSkipped++; continue; }
        existingTitles.add(norm);
        filteredInsights.push(insight);
      }
    }

    // Save insights
    if (filteredInsights.length > 0) {
      const rows = [];
      for (const i of filteredInsights) {
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
        rows.push({
          agent_id: agent.id, run_id: runId,
          insight_type: String(i.insight_type || "recommendation"),
          category: String(i.category || agent.domain),
          severity: String(i.severity || "info"),
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

    const activeInsights = filteredInsights.filter(i => (Number(i.confidence) || 0.5) >= confidenceThreshold).length;
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

IMPORTANTE: Eres un agente que reporta al CEO de Quimibond.

Reglas:
1. Solo genera insights que requieran ACCION del CEO o su equipo
2. Si no hay nada importante, devuelve []
3. NO repitas insights sobre el mismo tema/empresa que ya reportaste
4. Prioriza: riesgos financieros > oportunidades de venta > operaciones > info general
5. Cada insight debe tener evidencia concreta (numeros, fechas, nombres)
6. business_impact_estimate debe ser en MXN cuando sea posible calcular`;

function buildAgentPrompt(context: string, memoryText: string, threshold: number): string {
  // Truncate context if too long
  const truncatedContext = context.length > MAX_CONTEXT_CHARS
    ? context.slice(0, MAX_CONTEXT_CHARS) + "\n\n[...datos truncados por limite de tokens]"
    : context;

  return `Analiza los datos y genera SOLO insights accionables con confianza >= ${threshold}.

${truncatedContext}${memoryText}

Responde con un JSON array. Cada elemento debe tener EXACTAMENTE estos campos:
{
  "title": "string — titulo conciso y especifico (incluir empresa/monto si aplica)",
  "description": "string — contexto y analisis en 2-3 oraciones",
  "insight_type": "opportunity|risk|anomaly|recommendation|prediction",
  "category": "string — subcategoria (payment, delivery, crm, communication, inventory, etc.)",
  "severity": "info|low|medium|high|critical",
  "confidence": number 0-1,
  "recommendation": "string — accion especifica que el CEO/equipo debe tomar",
  "business_impact_estimate": number|null (MXN),
  "evidence": ["string — dato concreto que soporta el insight"],
  "company_name": "string exacto como aparece en datos|null",
  "contact_email": "string|null"
}`;
}

// ── Context builders ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildAgentContext(supabase: any, domain: string): Promise<string> {
  // Get recent email analysis summaries (all agents benefit from this)
  const { data: recentAnalysis } = await supabase
    .from("pipeline_logs").select("details")
    .eq("phase", "account_analysis")
    .order("created_at", { ascending: false }).limit(5);

  const analysisBrief = recentAnalysis?.length
    ? `## Analisis recientes de email\n${recentAnalysis.map((a: { details: Record<string, unknown> }) => `- ${a.details?.account}: ${a.details?.summary_text ?? ""}`).join("\n")}\n\n`
    : "";

  // Load email intelligence (facts + action_items) relevant to this domain
  const emailIntel = await getEmailIntelligence(supabase, domain);

  const domainData = await getDomainData(supabase, domain);
  return analysisBrief + emailIntel + domainData;
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
        `- [${f.fact_type}] ${f.fact_text}`
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
        `- [${a.priority}] ${a.action_type}: ${a.description.slice(0, 150)}${a.contact_name ? ` (${a.contact_name})` : ""}${a.assignee_name ? ` → ${a.assignee_name}` : ""}${a.due_date ? ` vence: ${a.due_date}` : ""}`
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
      `- VENCIDA ${a.due_date}: ${a.description.slice(0, 120)} → ${a.assignee_name || "sin asignar"}`
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
        `- ${c.fact_text}`
      ).join("\n")}`);
    }
  }

  return sections.length ? sections.join("\n\n") + "\n\n" : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDomainData(sb: any, domain: string): Promise<string> {
  // Load company profiles for domains that need company context
  const needsProfiles = ["sales", "finance", "risk", "growth", "relationships", "cleanup", "suppliers", "predictive"];
  let profileSection = "";
  if (needsProfiles.includes(domain)) {
    const { data: profiles } = await sb
      .from("company_profile")
      .select("name, total_revenue, revenue_90d, trend_pct, pending_amount, overdue_amount, overdue_count, max_days_overdue, late_deliveries, otd_rate, email_count, risk_level, tier")
      .in("tier", ["strategic", "important", "key_supplier"])
      .order("total_revenue", { ascending: false })
      .limit(25);
    if (profiles?.length) {
      profileSection = `## Perfil de empresas clave\n${safeJSON(profiles)}\n\n`;
    }
  }

  switch (domain) {
    case "sales": {
      const [orders, top, recentSaleOrders, margins] = await Promise.all([
        sb.from("odoo_order_lines").select("company_id, product_name, subtotal, order_date").eq("order_type", "sale").order("order_date", { ascending: false }).limit(25),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, total_orders, last_order_date, revenue_share_pct").gt("total_revenue", 0).order("total_revenue", { ascending: false }).limit(20),
        sb.from("odoo_sale_orders").select("company_id, name, state, amount_total, date_order").order("date_order", { ascending: false }).limit(15),
        sb.from("margin_analysis").select("company_name, product_name, avg_order_price, avg_invoice_price, price_delta_pct, total_order_value").not("price_delta_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
      ]);
      return `${profileSection}## Ordenes de venta recientes\n${safeJSON(recentSaleOrders.data)}\n## Lineas de venta\n${safeJSON(orders.data)}\n## Top clientes (con tendencia)\n${safeJSON(top.data)}\n## Analisis de margenes: precio orden vs precio factura\n${safeJSON(margins.data)}`;
    }
    case "finance": {
      const [inv, ow, payments, changes, margins] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue, invoice_date").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(30),
        sb.from("company_profile").select("name, pending_amount, overdue_amount, overdue_count, overdue_30d_count, max_days_overdue, total_revenue, tier").gt("overdue_amount", 0).order("overdue_amount", { ascending: false }).limit(20),
        sb.from("odoo_payments").select("company_id, amount, payment_date, state").order("payment_date", { ascending: false }).limit(15),
        sb.from("snapshot_changes").select("company_name, pending_now, pending_before, pending_change, overdue_now, overdue_before, overdue_change, late_now, late_before").limit(15),
        sb.from("margin_analysis").select("company_name, product_name, avg_order_price, avg_invoice_price, price_delta_pct").not("price_delta_pct", "is", null).gt("price_delta_pct", 10).order("price_delta_pct", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## Cambios vs semana pasada (snapshot)\n${safeJSON(changes.data)}\n## Facturas (ordenadas por dias vencidas)\n${safeJSON(inv.data)}\n## Empresas con cartera vencida (con contexto de revenue)\n${safeJSON(ow.data)}\n## Pagos recientes\n${safeJSON(payments.data)}\n## ALERTA: Productos facturados >10% arriba del precio de orden\n${safeJSON(margins.data)}`;
    }
    case "operations": {
      const [del, prod] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date").order("scheduled_date", { ascending: false }).limit(25),
        sb.from("odoo_products").select("name, stock_qty, available_qty, reorder_min").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(20),
      ]);
      return `${profileSection}## Entregas\n${safeJSON(del.data)}\n## Inventario critico (ordenado por stock disponible)\n${safeJSON(prod.data)}`;
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
      const [inv, risk, lateDeliveries, churning, changes] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_residual, days_overdue, invoice_date").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual", { ascending: false }).limit(15),
        sb.from("company_profile").select("name, total_revenue, overdue_amount, max_days_overdue, revenue_share_pct, risk_level, tier").in("risk_level", ["high", "critical"]).order("overdue_amount", { ascending: false }).limit(15),
        sb.from("odoo_deliveries").select("company_id, name, scheduled_date, is_late").eq("is_late", true).not("state", "in", '("done","cancel")').limit(10),
        sb.from("company_profile").select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, tier").in("tier", ["strategic", "important"]).lt("trend_pct", -30).limit(10),
        sb.from("snapshot_changes").select("company_name, overdue_now, overdue_before, overdue_change, pending_change, late_now, late_before").order("overdue_change", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## Cambios en riesgo vs semana pasada\n${safeJSON(changes.data)}\n## Facturas vencidas >30 dias\n${safeJSON(inv.data)}\n## Empresas en riesgo (con contexto completo)\n${safeJSON(risk.data)}\n## Entregas atrasadas\n${safeJSON(lateDeliveries.data)}\n## Clientes importantes con caida >30% (churn risk)\n${safeJSON(churning.data)}`;
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
        sb.from("client_reorder_predictions").select("company_name, order_count, avg_cycle_days, stddev_days, last_order_date, days_since_last, avg_order_value, predicted_next_order, days_overdue_reorder, reorder_status, total_revenue, tier").in("reorder_status", ["overdue", "at_risk", "critical", "lost"]).order("days_overdue_reorder", { ascending: false }).limit(20),
        sb.from("cash_flow_aging").select("company_name, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, tier").limit(15),
        sb.from("monthly_revenue_trend").select("month, revenue, active_clients, mom_change_pct").limit(15),
        sb.from("client_reorder_predictions").select("company_name, avg_cycle_days, days_since_last, avg_order_value, reorder_status, total_revenue, tier").eq("reorder_status", "on_track").in("tier", ["strategic", "important"]).order("total_revenue", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## Clientes con reorden VENCIDO o en riesgo\n${safeJSON(reorder.data)}\n## Cash flow aging (cartera por antigüedad)\n${safeJSON(cashFlow.data)}\n## Tendencia mensual de revenue\n${safeJSON(trend.data)}\n## Clientes estrategicos on-track (para prediccion de reorden)\n${safeJSON(topAtRisk.data)}`;
    }
    case "suppliers": {
      const [topSuppliers, recentPOs, priceChanges] = await Promise.all([
        sb.from("company_profile").select("name, total_purchases, total_revenue, email_count, contact_count, tier").gt("total_purchases", 50000).order("total_purchases", { ascending: false }).limit(20),
        sb.from("odoo_purchase_orders").select("company_id, name, amount_total, state, date_order").order("date_order", { ascending: false }).limit(20),
        sb.from("odoo_order_lines").select("company_id, product_name, subtotal, order_date").eq("order_type", "purchase").order("order_date", { ascending: false }).limit(30),
      ]);
      return `${profileSection}## Top proveedores (por monto de compra)\n${safeJSON(topSuppliers.data)}\n## Ordenes de compra recientes\n${safeJSON(recentPOs.data)}\n## Lineas de compra recientes (para detectar cambios de precio)\n${safeJSON(priceChanges.data)}`;
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
