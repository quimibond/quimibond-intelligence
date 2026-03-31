/**
 * Agent Orchestrator — The CEO's Intelligence Filter.
 *
 * Runs all active agents, then applies quality control:
 * 1. Each agent analyzes its domain (sales, finance, ops, etc.)
 * 2. Deduplication: merge similar insights across agents
 * 3. Confidence filter: only insights >= 0.7 pass
 * 4. Priority scoring: combine severity + business impact + recency
 * 5. CEO digest: top insights get priority tier (urgent/important/fyi)
 *
 * Called by Vercel Cron every 6 hours, or manually from dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

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
  const results: { agent: string; insights: number; status: string }[] = [];

  try {
    // ── Load agent definitions ──────────────────────────────────────────
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("is_active", true)
      .order("id");

    if (!agents?.length) {
      return NextResponse.json({ success: true, message: "No active agents", insights: 0 });
    }

    // ── Run each agent (except meta) ────────────────────────────────────
    const nonMetaAgents = agents.filter(a => a.slug !== "meta");

    for (const agent of nonMetaAgents) {
      try {
        const result = await runSingleAgent(supabase, apiKey, agent);
        results.push({ agent: agent.slug, insights: result.insightsGenerated, status: "ok" });
      } catch (err) {
        console.error(`[orchestrate] Agent ${agent.slug} failed:`, err);
        results.push({ agent: agent.slug, insights: 0, status: "failed" });
      }
    }

    // ── Quality control: deduplicate + filter ───────────────────────────
    const { data: newInsights } = await supabase
      .from("agent_insights")
      .select("id, title, description, severity, confidence, business_impact_estimate, insight_type, agent_id, created_at")
      .eq("state", "new")
      .order("created_at", { ascending: false })
      .limit(100);

    let filtered = 0;
    let promoted = 0;

    if (newInsights?.length) {
      // Remove low-confidence insights
      const lowConfidence = newInsights.filter(i => (i.confidence ?? 0) < 0.65);
      if (lowConfidence.length) {
        await supabase
          .from("agent_insights")
          .update({ state: "expired", user_feedback: "Auto-filtered: low confidence" })
          .in("id", lowConfidence.map(i => i.id));
        filtered += lowConfidence.length;
      }

      // Assign priority tiers to surviving insights
      const survivors = newInsights.filter(i => (i.confidence ?? 0) >= 0.65);
      for (const insight of survivors) {
        const tier = calculateTier(insight);
        // Store tier in the evidence field as metadata
        await supabase
          .from("agent_insights")
          .update({
            evidence: [{ priority_tier: tier, scored_at: new Date().toISOString() }],
          })
          .eq("id", insight.id);
        promoted++;
      }
    }

    // ── Run meta agent for cross-cutting analysis ───────────────────────
    const metaAgent = agents.find(a => a.slug === "meta");
    if (metaAgent) {
      try {
        const metaResult = await runSingleAgent(supabase, apiKey, metaAgent);
        results.push({ agent: "meta", insights: metaResult.insightsGenerated, status: "ok" });
      } catch (err) {
        console.error(`[orchestrate] Meta agent failed:`, err);
        results.push({ agent: "meta", insights: 0, status: "failed" });
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    const totalInsights = results.reduce((s, r) => s + r.insights, 0);

    // Log
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "agent_orchestration",
      message: `Orchestrated ${results.length} agents: ${totalInsights} insights, ${filtered} filtered, ${promoted} promoted`,
      details: { results, filtered, promoted, elapsed_s: elapsed },
    });

    return NextResponse.json({
      success: true,
      agents_run: results.length,
      total_insights: totalInsights,
      filtered_low_confidence: filtered,
      promoted_to_inbox: promoted,
      elapsed_s: elapsed,
      results,
    });
  } catch (err) {
    console.error("[orchestrate] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Priority tier calculation ──────────────────────────────────────────

function calculateTier(insight: {
  severity?: string;
  confidence?: number;
  business_impact_estimate?: number;
}): "urgent" | "important" | "fyi" {
  let score = 0;

  // Severity
  if (insight.severity === "critical") score += 40;
  else if (insight.severity === "high") score += 30;
  else if (insight.severity === "medium") score += 15;
  else score += 5;

  // Confidence
  score += (insight.confidence ?? 0.5) * 20;

  // Business impact
  const impact = insight.business_impact_estimate ?? 0;
  if (impact > 500000) score += 30;
  else if (impact > 100000) score += 20;
  else if (impact > 10000) score += 10;

  if (score >= 60) return "urgent";
  if (score >= 35) return "important";
  return "fyi";
}

// ── Single agent runner ────────────────────────────────────────────────

interface AgentDef {
  id: number;
  slug: string;
  name: string;
  domain: string;
  system_prompt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function runSingleAgent(
  supabase: SB,
  apiKey: string,
  agent: AgentDef
): Promise<{ insightsGenerated: number }> {
  // Create run record
  const { data: run } = await supabase
    .from("agent_runs")
    .insert({ agent_id: agent.id, status: "running", trigger_type: "orchestrator" })
    .select("id")
    .single();
  const runId = run?.id;
  const startTime = Date.now();

  try {
    // Gather context based on domain
    const context = await gatherContext(supabase, agent.domain);

    // Load agent memories
    const { data: memories } = await supabase
      .from("agent_memory")
      .select("content, memory_type")
      .eq("agent_id", agent.id)
      .order("importance", { ascending: false })
      .limit(5);

    const memoryText = memories?.length
      ? `\n\nTus observaciones previas:\n${memories.map((m: { content: string }) => `- ${m.content}`).join("\n")}`
      : "";

    // Call Claude
    const { result, usage } = await callClaudeJSON<Record<string, unknown>[]>(
      apiKey,
      {
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
        max_tokens: 4096,
        temperature: 0.2,
        system: agent.system_prompt + `\n\nIMPORTANTE: Eres un agente que reporta al CEO. Solo genera insights que realmente importen para tomar decisiones de negocio. No reportes cosas obvias ni basura. Cada insight debe tener una accion concreta. Si no hay nada importante que reportar, devuelve un array vacio [].`,
        messages: [{
          role: "user",
          content: `Analiza estos datos y genera SOLO insights accionables para el CEO.\nSi no hay nada importante, devuelve []\n\n${context}${memoryText}\n\nResponde con JSON array. Cada insight:\n- title (corto, directo)\n- description (contexto necesario)\n- insight_type: opportunity|risk|anomaly|recommendation|prediction\n- category (string)\n- severity: info|low|medium|high|critical\n- confidence (0-1, se honesto)\n- recommendation (accion concreta para el CEO)\n- business_impact_estimate (MXN estimado, null si no aplica)\n- evidence (array de datos que soportan el insight)`,
        }],
      },
      `agent-${agent.slug}`
    );

    const insights = Array.isArray(result) ? result : [];

    // Write insights
    if (insights.length > 0) {
      const rows = insights.map(i => ({
        agent_id: agent.id,
        run_id: runId,
        insight_type: String(i.insight_type || "recommendation"),
        category: String(i.category || agent.domain),
        severity: String(i.severity || "info"),
        title: String(i.title || ""),
        description: String(i.description || ""),
        evidence: i.evidence || [],
        recommendation: i.recommendation ? String(i.recommendation) : null,
        confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.5)),
        business_impact_estimate: i.business_impact_estimate ? Number(i.business_impact_estimate) : null,
        state: "new",
      }));
      await supabase.from("agent_insights").insert(rows);
    }

    // Update run
    const duration = (Date.now() - startTime) / 1000;
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        duration_seconds: Math.round(duration * 10) / 10,
        insights_generated: insights.length,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
      }).eq("id", runId);
    }

    if (usage) {
      logTokenUsage(`agent-${agent.slug}`, process.env.CLAUDE_MODEL || "claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);
    }

    return { insightsGenerated: insights.length };
  } catch (err) {
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: String(err),
      }).eq("id", runId);
    }
    throw err;
  }
}

// ── Context gatherers ──────────────────────────────────────────────────

async function gatherContext(supabase: SB, domain: string): Promise<string> {
  // Get recent pipeline analysis summaries (raw data from pipeline)
  const { data: recentAnalysis } = await supabase
    .from("pipeline_logs")
    .select("details")
    .eq("phase", "account_analysis")
    .order("created_at", { ascending: false })
    .limit(10);

  const analysisSummary = recentAnalysis?.length
    ? `## Analisis recientes de emails\n${recentAnalysis.map((a: { details: unknown }) => {
        const d = a.details as Record<string, unknown>;
        return `- ${d.account}: ${d.summary_text ?? "sin resumen"} (sentiment: ${d.sentiment ?? "?"}, topics: ${JSON.stringify(d.topics ?? [])})`;
      }).join("\n")}`
    : "";

  const domainContext = await getDomainData(supabase, domain);

  return `${analysisSummary}\n\n${domainContext}`;
}

async function getDomainData(supabase: SB, domain: string): Promise<string> {
  switch (domain) {
    case "sales": {
      const [orders, leads, topClients] = await Promise.all([
        supabase.from("odoo_order_lines").select("company_id, product_name, subtotal, order_date").eq("order_type", "sale").order("order_date", { ascending: false }).limit(50),
        supabase.from("odoo_crm_leads").select("*").eq("active", true),
        supabase.from("companies").select("id, name, lifetime_value, trend_pct").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(15),
      ]);
      return `## Ventas\n${JSON.stringify(orders.data?.slice(0, 30))}\n\n## CRM\n${JSON.stringify(leads.data)}\n\n## Top clientes\n${JSON.stringify(topClients.data)}`;
    }
    case "finance": {
      const [invoices, overdue] = await Promise.all([
        supabase.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(50),
        supabase.from("companies").select("id, name, total_pending, lifetime_value").not("total_pending", "is", null).gt("total_pending", 0).order("total_pending", { ascending: false }).limit(20),
      ]);
      return `## Facturas\n${JSON.stringify(invoices.data?.slice(0, 30))}\n\n## Empresas con saldo\n${JSON.stringify(overdue.data)}`;
    }
    case "operations": {
      const [deliveries, products] = await Promise.all([
        supabase.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date").order("scheduled_date", { ascending: false }).limit(50),
        supabase.from("odoo_products").select("name, stock_qty, available_qty, reorder_min").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(30),
      ]);
      return `## Entregas\n${JSON.stringify(deliveries.data?.slice(0, 30))}\n\n## Inventario critico\n${JSON.stringify(products.data)}`;
    }
    case "relationships": {
      const [contacts, threads, health] = await Promise.all([
        supabase.from("contacts").select("id, name, email, risk_level, sentiment_score, current_health_score, last_activity").eq("contact_type", "external").order("current_health_score", { ascending: true, nullsFirst: false }).limit(30),
        supabase.from("threads").select("subject, status, hours_without_response, company_id").in("status", ["needs_response", "stalled"]).limit(20),
        supabase.from("health_scores").select("contact_email, overall_score, trend, score_date").order("score_date", { ascending: false }).limit(30),
      ]);
      return `## Contactos (peor health score primero)\n${JSON.stringify(contacts.data)}\n\n## Threads sin respuesta\n${JSON.stringify(threads.data)}\n\n## Health scores\n${JSON.stringify(health.data)}`;
    }
    case "risk": {
      const [overdueInv, lateDeliveries, atRisk] = await Promise.all([
        supabase.from("odoo_invoices").select("company_id, amount_residual, days_overdue").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual", { ascending: false }).limit(20),
        supabase.from("odoo_deliveries").select("company_id, name, scheduled_date").eq("is_late", true).limit(20),
        supabase.from("contacts").select("id, name, risk_level, current_health_score, company_id").in("risk_level", ["high", "critical"]).limit(20),
      ]);
      return `## Facturas vencidas >30d\n${JSON.stringify(overdueInv.data)}\n\n## Entregas atrasadas\n${JSON.stringify(lateDeliveries.data)}\n\n## Contactos en riesgo\n${JSON.stringify(atRisk.data)}`;
    }
    case "growth": {
      const [topClients, recentOrders] = await Promise.all([
        supabase.from("companies").select("id, name, lifetime_value, trend_pct, is_customer").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(20),
        supabase.from("odoo_order_lines").select("company_id, product_name, subtotal").eq("order_type", "sale").order("order_date", { ascending: false }).limit(50),
      ]);
      return `## Top clientes\n${JSON.stringify(topClients.data)}\n\n## Ventas recientes\n${JSON.stringify(recentOrders.data?.slice(0, 30))}`;
    }
    case "meta": {
      const [runs, insights] = await Promise.all([
        supabase.from("agent_runs").select("agent_id, status, insights_generated, duration_seconds").order("started_at", { ascending: false }).limit(30),
        supabase.from("agent_insights").select("agent_id, insight_type, severity, state, confidence, was_useful").order("created_at", { ascending: false }).limit(50),
      ]);
      return `## Corridas de agentes\n${JSON.stringify(runs.data)}\n\n## Insights generados\n${JSON.stringify(insights.data)}`;
    }
    default:
      return "";
  }
}
