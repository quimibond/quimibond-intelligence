/**
 * Agent Orchestrator v2 — Incremental, ONE agent per call.
 *
 * Same pattern as analyze: each invocation processes the NEXT agent
 * that hasn't run recently. Vercel cron calls this every 15 min
 * during the 4-hour cycle, so all agents get processed.
 *
 * On manual trigger, runs the agent that needs it most.
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

    // Pick the agent that ran least recently (or never)
    let targetAgent = agents[0];
    let oldestRun = Date.now();

    for (const agent of agents) {
      const lastRun = lastRunMap.get(agent.id);
      if (!lastRun) {
        // Never ran — highest priority
        targetAgent = agent;
        oldestRun = 0;
        break;
      }
      const runTime = new Date(lastRun).getTime();
      if (runTime < oldestRun) {
        oldestRun = runTime;
        targetAgent = agent;
      }
    }

    console.log(`[orchestrate] Running ${targetAgent.slug} (last ran: ${oldestRun === 0 ? "never" : new Date(oldestRun).toISOString()})`);

    // ── Run the selected agent ──────────────────────────────────────────
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({ agent_id: targetAgent.id, status: "running", trigger_type: "orchestrator" })
      .select("id")
      .single();
    const runId = run?.id;

    try {
      // Build context
      const context = await buildAgentContext(supabase, targetAgent.domain);

      // Load memories
      const { data: memories } = await supabase
        .from("agent_memory")
        .select("content")
        .eq("agent_id", targetAgent.id)
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
          system: targetAgent.system_prompt + `\n\nIMPORTANTE: Eres un agente que reporta al CEO. Solo genera insights que realmente importen. Si no hay nada importante, devuelve [].`,
          messages: [{
            role: "user",
            content: `Analiza y genera SOLO insights accionables.\n\n${context}${memoryText}\n\nJSON array. Cada insight: title, description, insight_type (opportunity|risk|anomaly|recommendation|prediction), category, severity (info|low|medium|high|critical), confidence (0-1), recommendation, business_impact_estimate (MXN o null), evidence (array), company_name (exacto o null), contact_email (o null)`,
          }],
        },
        `agent-${targetAgent.slug}`
      );

      const insights = Array.isArray(result) ? result : [];

      // Resolve company names and write insights
      if (insights.length > 0) {
        const rows = [];
        for (const i of insights) {
          let companyId: number | null = null;
          if (i.company_name) {
            const { data: co } = await supabase
              .from("companies").select("id")
              .ilike("canonical_name", String(i.company_name).trim())
              .limit(1).single();
            if (co) companyId = co.id;
          }
          if (!companyId && i.company_id) companyId = Number(i.company_id);

          let contactId: number | null = null;
          if (i.contact_email) {
            const { data: ct } = await supabase
              .from("contacts").select("id, company_id")
              .eq("email", String(i.contact_email).toLowerCase())
              .limit(1).single();
            if (ct) {
              contactId = ct.id;
              if (!companyId && ct.company_id) companyId = ct.company_id;
            }
          }

          rows.push({
            agent_id: targetAgent.id, run_id: runId,
            insight_type: String(i.insight_type || "recommendation"),
            category: String(i.category || targetAgent.domain),
            severity: String(i.severity || "info"),
            title: String(i.title || ""),
            description: String(i.description || ""),
            evidence: i.evidence || [],
            recommendation: i.recommendation ? String(i.recommendation) : null,
            confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.5)),
            business_impact_estimate: i.business_impact_estimate ? Number(i.business_impact_estimate) : null,
            company_id: companyId, contact_id: contactId,
            state: "new",
          });
        }
        await supabase.from("agent_insights").insert(rows);
      }

      // Filter low confidence
      if (insights.length > 0) {
        const { data: newInsights } = await supabase
          .from("agent_insights")
          .select("id, confidence")
          .eq("run_id", runId)
          .lt("confidence", 0.65);
        if (newInsights?.length) {
          await supabase.from("agent_insights")
            .update({ state: "expired", user_feedback: "Auto-filtered: low confidence" })
            .in("id", newInsights.map(i => i.id));
        }
      }

      const duration = (Date.now() - start) / 1000;
      if (runId) {
        await supabase.from("agent_runs").update({
          status: "completed", completed_at: new Date().toISOString(),
          duration_seconds: Math.round(duration * 10) / 10,
          insights_generated: insights.length,
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
        }).eq("id", runId);
      }

      if (usage) logTokenUsage(`agent-${targetAgent.slug}`, process.env.CLAUDE_MODEL || "claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);

      // How many agents still need to run?
      const recentThreshold = new Date(Date.now() - 4 * 3600_000).toISOString();
      const agentsNeedingRun = agents.filter(a => {
        const last = lastRunMap.get(a.id);
        return !last || last < recentThreshold;
      }).length - 1; // -1 for the one we just ran

      return NextResponse.json({
        success: true,
        agent: targetAgent.slug,
        insights_generated: insights.length,
        elapsed_s: Math.round(duration),
        remaining_agents: Math.max(0, agentsNeedingRun),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (runId) {
        await supabase.from("agent_runs").update({
          status: "failed", completed_at: new Date().toISOString(), error_message: errMsg,
        }).eq("id", runId);
      }
      return NextResponse.json({ error: errMsg, agent: targetAgent.slug }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
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
    ? `## Analisis recientes\n${recentAnalysis.map((a: { details: Record<string, unknown> }) => `- ${a.details?.account}: ${a.details?.summary_text ?? ""}`).join("\n")}\n\n`
    : "";

  const domainData = await getDomainData(supabase, domain);
  return analysisBrief + domainData;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDomainData(sb: any, domain: string): Promise<string> {
  switch (domain) {
    case "sales": {
      const [orders, leads, top] = await Promise.all([
        sb.from("odoo_order_lines").select("company_id, product_name, subtotal, order_date").eq("order_type", "sale").order("order_date", { ascending: false }).limit(30),
        sb.from("odoo_crm_leads").select("*").eq("active", true),
        sb.from("companies").select("id, name, lifetime_value").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(15),
      ]);
      return `## Ventas\n${JSON.stringify(orders.data?.slice(0, 20))}\n## CRM\n${JSON.stringify(leads.data)}\n## Top\n${JSON.stringify(top.data)}`;
    }
    case "finance": {
      const [inv, ow] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, days_overdue").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(30),
        sb.from("companies").select("id, name, total_pending").not("total_pending", "is", null).gt("total_pending", 0).order("total_pending", { ascending: false }).limit(20),
      ]);
      return `## Facturas\n${JSON.stringify(inv.data)}\n## Saldos\n${JSON.stringify(ow.data)}`;
    }
    case "operations": {
      const [del, prod] = await Promise.all([
        sb.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date").order("scheduled_date", { ascending: false }).limit(30),
        sb.from("odoo_products").select("name, stock_qty, available_qty, reorder_min").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(20),
      ]);
      return `## Entregas\n${JSON.stringify(del.data)}\n## Inventario\n${JSON.stringify(prod.data)}`;
    }
    case "relationships": {
      const [ct, th] = await Promise.all([
        sb.from("contacts").select("id, name, risk_level, current_health_score, last_activity").eq("contact_type", "external").order("current_health_score", { ascending: true, nullsFirst: false }).limit(20),
        sb.from("threads").select("subject, status, hours_without_response").in("status", ["needs_response", "stalled"]).limit(15),
      ]);
      return `## Contactos\n${JSON.stringify(ct.data)}\n## Threads\n${JSON.stringify(th.data)}`;
    }
    case "risk": {
      const [inv, risk] = await Promise.all([
        sb.from("odoo_invoices").select("company_id, amount_residual, days_overdue").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual", { ascending: false }).limit(15),
        sb.from("contacts").select("id, name, risk_level, current_health_score").in("risk_level", ["high", "critical"]).limit(15),
      ]);
      return `## Vencidas\n${JSON.stringify(inv.data)}\n## Riesgo\n${JSON.stringify(risk.data)}`;
    }
    case "growth": {
      const [top] = await Promise.all([
        sb.from("companies").select("id, name, lifetime_value, trend_pct").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(20),
      ]);
      return `## Top\n${JSON.stringify(top.data)}`;
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
      const [r, i] = await Promise.all([
        sb.from("agent_runs").select("agent_id, status, insights_generated").order("started_at", { ascending: false }).limit(20),
        sb.from("agent_insights").select("agent_id, severity, state, confidence, was_useful").order("created_at", { ascending: false }).limit(30),
      ]);
      return `## Runs\n${JSON.stringify(r.data)}\n## Insights\n${JSON.stringify(i.data)}`;
    }
    default: return "";
  }
}
