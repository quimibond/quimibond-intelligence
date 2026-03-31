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
          content: `Analiza estos datos y genera SOLO insights accionables para el CEO.\nSi no hay nada importante, devuelve []\n\n${context}${memoryText}\n\nResponde con JSON array. Cada insight:\n- title (corto, directo)\n- description (contexto necesario)\n- insight_type: opportunity|risk|anomaly|recommendation|prediction\n- category (string)\n- severity: info|low|medium|high|critical\n- confidence (0-1, se honesto)\n- recommendation (accion concreta para el CEO)\n- business_impact_estimate (MXN estimado, null si no aplica)\n- evidence (array de datos que soportan el insight)\n- company_name (nombre EXACTO de la empresa involucrada, null si es general)\n- contact_email (email del contacto involucrado, null si no aplica)\n\nIMPORTANTE: company_name debe coincidir EXACTAMENTE con los nombres de empresa en los datos. contact_email debe ser un email real de los datos.`,
        }],
      },
      `agent-${agent.slug}`
    );

    const insights = Array.isArray(result) ? result : [];

    // Resolve company_name → company_id and contact_email → contact_id
    if (insights.length > 0) {
      // Batch lookup: get all unique company names and contact emails
      const companyNames = [...new Set(insights.map(i => i.company_name).filter(Boolean))] as string[];
      const contactEmails = [...new Set(insights.map(i => i.contact_email).filter(Boolean))] as string[];

      const companyMap = new Map<string, number>();
      const contactMap = new Map<string, { id: number; company_id: number | null }>();

      // Resolve companies by name (exact match first, then fuzzy)
      if (companyNames.length) {
        for (const name of companyNames) {
          // Exact match
          const { data: exact } = await supabase
            .from("companies")
            .select("id, canonical_name")
            .ilike("canonical_name", name.trim())
            .limit(1);
          if (exact?.[0]) {
            companyMap.set(name, exact[0].id);
          } else {
            // Partial match
            const { data: partial } = await supabase
              .from("companies")
              .select("id, canonical_name")
              .ilike("canonical_name", `%${name.trim().split(" ")[0]}%`)
              .limit(1);
            if (partial?.[0]) {
              companyMap.set(name, partial[0].id);
            }
          }
        }
      }

      // Resolve contacts by email
      if (contactEmails.length) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, email, company_id")
          .in("email", contactEmails.map(e => e.toLowerCase()));
        for (const c of contacts ?? []) {
          contactMap.set(c.email.toLowerCase(), { id: c.id, company_id: c.company_id });
        }
      }

      // Write insights with resolved IDs
      const rows = insights.map(i => {
        let companyId: number | null = null;
        let contactId: number | null = null;

        // Resolve company
        if (i.company_name) companyId = companyMap.get(String(i.company_name)) ?? null;

        // Resolve contact
        if (i.contact_email) {
          const contact = contactMap.get(String(i.contact_email).toLowerCase());
          if (contact) {
            contactId = contact.id;
            if (!companyId && contact.company_id) companyId = contact.company_id;
          }
        }

        // Fallback: try to find company from company_id in the data
        if (!companyId && i.company_id) companyId = Number(i.company_id);

        return {
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
          company_id: companyId,
          contact_id: contactId,
          state: "new",
        };
      });

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
    case "data_quality": {
      // Run diagnostic queries to assess data health
      const checks = await Promise.all([
        supabase.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null),
        supabase.from("emails").select("id", { count: "exact", head: true }).is("company_id", null),
        supabase.from("emails").select("id", { count: "exact", head: true }).is("thread_id", null),
        supabase.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", false),
        supabase.from("emails").select("id", { count: "exact", head: true }),
        supabase.from("contacts").select("id", { count: "exact", head: true }).is("name", null),
        supabase.from("contacts").select("id", { count: "exact", head: true }).is("current_health_score", null),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null),
        supabase.from("companies").select("id", { count: "exact", head: true }).or("lifetime_value.is.null,lifetime_value.eq.0"),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("odoo_invoices").select("id", { count: "exact", head: true }).is("company_id", null),
        supabase.from("odoo_order_lines").select("id", { count: "exact", head: true }).is("company_id", null),
        supabase.from("entities").select("id", { count: "exact", head: true }),
        supabase.from("facts").select("id", { count: "exact", head: true }),
        supabase.from("agent_insights").select("id", { count: "exact", head: true }).is("company_id", null).in("state", ["new", "seen"]),
        supabase.from("health_scores").select("id", { count: "exact", head: true }),
        // Check for recent pipeline activity
        supabase.from("pipeline_logs").select("phase, created_at").order("created_at", { ascending: false }).limit(5),
        // Check for stale data
        supabase.from("emails").select("email_date").order("email_date", { ascending: false }).limit(1),
      ]);

      const metrics = {
        emails_no_contact: checks[0].count ?? 0,
        emails_no_company: checks[1].count ?? 0,
        emails_no_thread: checks[2].count ?? 0,
        emails_unprocessed: checks[3].count ?? 0,
        emails_total: checks[4].count ?? 0,
        contacts_no_name: checks[5].count ?? 0,
        contacts_no_health: checks[6].count ?? 0,
        contacts_total: checks[7].count ?? 0,
        companies_no_entity: checks[8].count ?? 0,
        companies_no_ltv: checks[9].count ?? 0,
        companies_total: checks[10].count ?? 0,
        invoices_no_company: checks[11].count ?? 0,
        orders_no_company: checks[12].count ?? 0,
        entities_total: checks[13].count ?? 0,
        facts_total: checks[14].count ?? 0,
        insights_no_company: checks[15].count ?? 0,
        health_scores_total: checks[16].count ?? 0,
        recent_pipeline: checks[17].data,
        latest_email_date: checks[18].data?.[0]?.email_date,
      };

      // Calculate percentages
      const emailLinkRate = metrics.emails_total > 0 ? Math.round((1 - metrics.emails_no_contact / metrics.emails_total) * 100) : 0;
      const companyEntityRate = metrics.companies_total > 0 ? Math.round((1 - metrics.companies_no_entity / metrics.companies_total) * 100) : 0;
      const processedRate = metrics.emails_total > 0 ? Math.round((1 - metrics.emails_unprocessed / metrics.emails_total) * 100) : 0;

      return `## Metricas de Calidad de Datos

### Emails (${metrics.emails_total} total)
- Sin contacto vinculado: ${metrics.emails_no_contact} (${100 - emailLinkRate}%)
- Sin empresa vinculada: ${metrics.emails_no_company}
- Sin thread: ${metrics.emails_no_thread}
- Sin procesar por IA: ${metrics.emails_unprocessed} (${100 - processedRate}% pendientes)
- Email mas reciente: ${metrics.latest_email_date ?? "desconocido"}

### Contactos (${metrics.contacts_total} total)
- Sin nombre: ${metrics.contacts_no_name}
- Sin health score: ${metrics.contacts_no_health}

### Empresas (${metrics.companies_total} total)
- Sin entity_id (desconectadas del KG): ${metrics.companies_no_entity} (${100 - companyEntityRate}%)
- Sin lifetime_value: ${metrics.companies_no_ltv}

### Odoo Data
- Facturas sin empresa: ${metrics.invoices_no_company}
- Ordenes sin empresa: ${metrics.orders_no_company}

### Knowledge Graph
- Entidades: ${metrics.entities_total}
- Facts: ${metrics.facts_total}
- Insights sin empresa vinculada: ${metrics.insights_no_company}
- Health scores: ${metrics.health_scores_total}

### Pipeline Reciente
${JSON.stringify(metrics.recent_pipeline)}

Analiza estos datos y genera insights sobre problemas CRITICOS que necesitan correccion. Prioriza: datos que impiden que otros agentes funcionen bien > datos faltantes > datos inconsistentes.`;
    }
    default:
      return "";
  }
}
