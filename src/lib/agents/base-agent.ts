/**
 * Base agent runner — gathers context, calls Claude, writes insights.
 * Each specialized agent extends the context-gathering step.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";

// ── Types ──

export interface AgentDefinition {
  id: number;
  slug: string;
  name: string;
  domain: string;
  system_prompt: string;
  config: Record<string, unknown>;
}

export interface AgentInsightInput {
  title: string;
  description: string;
  insight_type: string;
  category?: string;
  severity?: string;
  confidence?: number;
  recommendation?: string;
  business_impact_estimate?: number;
  evidence?: unknown[];
  company_id?: number;
  contact_id?: number;
}

export interface AgentRunResult {
  run_id: number;
  status: "completed" | "failed" | "partial";
  insights_generated: number;
  duration_seconds: number;
  error?: string;
}

// ── Supabase client ──

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient(url, key);
}

// ── Context builders per domain ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContextBuilder = (supabase: SupabaseClient<any>) => Promise<string>;

const contextBuilders: Record<string, ContextBuilder> = {
  async sales(sb) {
    const [orders, leads, invoices, topClients] = await Promise.all([
      sb.from("odoo_order_lines").select("order_type, product_name, qty, subtotal, order_date, company_id").eq("order_type", "sale").order("order_date", { ascending: false }).limit(100),
      sb.from("odoo_crm_leads").select("*").eq("active", true).limit(50),
      sb.from("odoo_invoices").select("company_id, amount_total, amount_residual, payment_state, invoice_date, days_overdue").eq("move_type", "out_invoice").order("invoice_date", { ascending: false }).limit(100),
      sb.from("companies").select("id, name, lifetime_value, is_customer, trend_pct").eq("is_customer", true).order("lifetime_value", { ascending: false }).limit(20),
    ]);
    return `## Ventas recientes (${orders.data?.length ?? 0} lineas)\n${JSON.stringify(orders.data?.slice(0, 50))}\n\n## CRM Leads (${leads.data?.length ?? 0})\n${JSON.stringify(leads.data)}\n\n## Facturas recientes\n${JSON.stringify(invoices.data?.slice(0, 30))}\n\n## Top 20 clientes\n${JSON.stringify(topClients.data)}`;
  },

  async finance(sb) {
    const [invoices, payments, overdue, aging] = await Promise.all([
      sb.from("odoo_invoices").select("company_id, name, amount_total, amount_residual, payment_state, invoice_date, due_date, days_overdue").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(100),
      sb.from("odoo_payments").select("company_id, amount, payment_date, payment_type").order("payment_date", { ascending: false }).limit(50),
      sb.from("odoo_invoices").select("company_id, amount_residual, days_overdue").gt("days_overdue", 0).eq("move_type", "out_invoice"),
      sb.from("companies").select("id, name, lifetime_value, total_pending, credit_limit").not("total_pending", "is", null).order("total_pending", { ascending: false }).limit(30),
    ]);
    const totalOverdue = (overdue.data ?? []).reduce((s: number, i: Record<string, unknown>) => s + (Number(i.amount_residual) || 0), 0);
    return `## Facturas (${invoices.data?.length ?? 0}, total vencido: $${totalOverdue.toFixed(0)})\n${JSON.stringify(invoices.data?.slice(0, 50))}\n\n## Pagos recientes\n${JSON.stringify(payments.data)}\n\n## Empresas con saldo pendiente\n${JSON.stringify(aging.data)}`;
  },

  async operations(sb) {
    const [deliveries, products, manufacturing] = await Promise.all([
      sb.from("odoo_deliveries").select("company_id, name, state, is_late, lead_time_days, scheduled_date, origin").order("scheduled_date", { ascending: false }).limit(100),
      sb.from("odoo_products").select("name, stock_qty, available_qty, reorder_min, reorder_max, category").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(50),
      sb.from("odoo_manufacturing").select("*").order("date_start", { ascending: false }).limit(50),
    ]);
    const lateCount = (deliveries.data ?? []).filter((d: Record<string, unknown>) => d.is_late).length;
    return `## Entregas (${deliveries.data?.length ?? 0}, ${lateCount} atrasadas)\n${JSON.stringify(deliveries.data?.slice(0, 50))}\n\n## Productos con reorder rules (stock bajo?)\n${JSON.stringify(products.data)}\n\n## Manufactura\n${JSON.stringify(manufacturing.data)}`;
  },

  async relationships(sb) {
    const [health, contacts, threads, comms] = await Promise.all([
      sb.from("health_scores").select("contact_id, contact_email, overall_score, communication_score, sentiment_score, trend, score_date").order("score_date", { ascending: false }).limit(100),
      sb.from("contacts").select("id, email, name, risk_level, sentiment_score, relationship_score, avg_response_time_hours, last_activity, company_id").eq("contact_type", "external").order("relationship_score", { ascending: true }).limit(50),
      sb.from("threads").select("subject, status, hours_without_response, last_activity, company_id").in("status", ["needs_response", "stalled"]).limit(30),
      sb.from("communication_metrics").select("*").order("metric_date", { ascending: false }).limit(14),
    ]);
    return `## Health Scores recientes\n${JSON.stringify(health.data?.slice(0, 50))}\n\n## Contactos de menor score\n${JSON.stringify(contacts.data)}\n\n## Threads sin respuesta\n${JSON.stringify(threads.data)}\n\n## Metricas de comunicacion\n${JSON.stringify(comms.data)}`;
  },

  async risk(sb) {
    const [overdueInv, lateDeliveries, atRisk, actions] = await Promise.all([
      sb.from("odoo_invoices").select("company_id, amount_residual, days_overdue").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual", { ascending: false }).limit(30),
      sb.from("odoo_deliveries").select("company_id, name, scheduled_date, is_late").eq("is_late", true).limit(30),
      sb.from("contacts").select("id, name, email, risk_level, sentiment_score, company_id").in("risk_level", ["high", "critical"]).limit(30),
      sb.from("action_items").select("description, priority, state, assignee_name, due_date, contact_name").eq("state", "pending").order("due_date", { ascending: true }).limit(30),
    ]);
    return `## Facturas vencidas >30 dias\n${JSON.stringify(overdueInv.data)}\n\n## Entregas atrasadas\n${JSON.stringify(lateDeliveries.data)}\n\n## Contactos en riesgo\n${JSON.stringify(atRisk.data)}\n\n## Acciones pendientes\n${JSON.stringify(actions.data)}`;
  },

  async growth(sb) {
    const [topClients, orders, products, leads] = await Promise.all([
      sb.from("companies").select("id, name, lifetime_value, trend_pct, is_customer, is_supplier").eq("is_customer", true).order("lifetime_value", { ascending: false }).limit(30),
      sb.from("odoo_order_lines").select("company_id, product_name, subtotal, order_date, order_type").eq("order_type", "sale").order("order_date", { ascending: false }).limit(100),
      sb.from("odoo_order_lines").select("product_name, subtotal").eq("order_type", "sale").order("subtotal", { ascending: false }).limit(50),
      sb.from("odoo_crm_leads").select("*").eq("active", true),
    ]);
    return `## Top clientes por lifetime value\n${JSON.stringify(topClients.data)}\n\n## Ordenes recientes\n${JSON.stringify(orders.data?.slice(0, 50))}\n\n## Productos mas vendidos\n${JSON.stringify(products.data)}\n\n## Pipeline CRM\n${JSON.stringify(leads.data)}`;
  },

  async meta(sb) {
    const [agents, runs, insights] = await Promise.all([
      sb.from("ai_agents").select("slug, name, is_active"),
      sb.from("agent_runs").select("agent_id, status, insights_generated, duration_seconds, input_tokens, output_tokens, started_at").order("started_at", { ascending: false }).limit(50),
      sb.from("agent_insights").select("agent_id, insight_type, severity, state, confidence, was_useful, created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    return `## Agentes\n${JSON.stringify(agents.data)}\n\n## Ultimas corridas\n${JSON.stringify(runs.data)}\n\n## Insights recientes (aceptados/rechazados)\n${JSON.stringify(insights.data)}`;
  },
};

// ── Main runner ──

export async function runAgent(agentSlug: string, triggerType: string = "manual"): Promise<AgentRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const supabase = getServiceClient();
  const startTime = Date.now();

  // 1. Load agent definition
  const { data: agent } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("slug", agentSlug)
    .single();

  if (!agent) throw new Error(`Agent '${agentSlug}' not found`);

  // 2. Create run record
  const { data: run } = await supabase
    .from("agent_runs")
    .insert({ agent_id: agent.id, status: "running", trigger_type: triggerType })
    .select("id")
    .single();

  const runId = run?.id;

  try {
    // 3. Gather context
    const builder = contextBuilders[agent.domain] ?? contextBuilders.risk;
    const context = await builder(supabase);

    // 4. Load agent memories
    const { data: memories } = await supabase
      .from("agent_memory")
      .select("content, memory_type")
      .eq("agent_id", agent.id)
      .order("importance", { ascending: false })
      .limit(10);

    const memoryContext = memories?.length
      ? `\n\n## Tus memorias previas\n${memories.map(m => `- [${m.memory_type}] ${m.content}`).join("\n")}`
      : "";

    // 5. Call Claude
    const userMessage = `Analiza los siguientes datos y genera entre 3 y 8 insights accionables.

${context}${memoryContext}

Responde SOLO con un JSON array de insights, cada uno con estos campos:
- title (string, corto)
- description (string, detallado)
- insight_type: "opportunity" | "risk" | "anomaly" | "recommendation" | "prediction"
- category (string)
- severity: "info" | "low" | "medium" | "high" | "critical"
- confidence (number 0-1)
- recommendation (string, accion concreta)
- business_impact_estimate (number, estimacion en MXN si aplica, null si no)
- evidence (array de strings con datos de soporte)`;

    const { result, usage } = await callClaudeJSON<AgentInsightInput[]>(
      apiKey,
      {
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
        max_tokens: 4096,
        temperature: 0.3,
        system: agent.system_prompt,
        messages: [{ role: "user", content: userMessage }],
      },
      `agent-${agentSlug}`
    );

    // 6. Ensure result is array
    const insights: AgentInsightInput[] = Array.isArray(result) ? result : [];

    // 7. Write insights
    if (insights.length > 0) {
      const rows = insights.map(i => ({
        agent_id: agent.id,
        run_id: runId,
        insight_type: i.insight_type || "recommendation",
        category: i.category || agent.domain,
        severity: i.severity || "info",
        title: i.title,
        description: i.description,
        evidence: i.evidence || [],
        recommendation: i.recommendation,
        confidence: Math.min(1, Math.max(0, i.confidence ?? 0.5)),
        business_impact_estimate: i.business_impact_estimate,
        company_id: i.company_id || null,
        contact_id: i.contact_id || null,
        state: "new",
      }));

      await supabase.from("agent_insights").insert(rows);
    }

    // 8. Update run
    const duration = (Date.now() - startTime) / 1000;
    await supabase
      .from("agent_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        duration_seconds: Math.round(duration * 10) / 10,
        insights_generated: insights.length,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
      })
      .eq("id", runId);

    if (usage) {
      logTokenUsage(`agent-${agentSlug}`, process.env.CLAUDE_MODEL || "claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);
    }

    return { run_id: runId!, status: "completed", insights_generated: insights.length, duration_seconds: duration };
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({ status: "failed", completed_at: new Date().toISOString(), duration_seconds: duration, error_message: errorMsg })
        .eq("id", runId);
    }

    return { run_id: runId ?? 0, status: "failed", insights_generated: 0, duration_seconds: duration, error: errorMsg };
  }
}

/** Run all active agents sequentially */
export async function runAllAgents(triggerType: string = "scheduled"): Promise<AgentRunResult[]> {
  const supabase = getServiceClient();
  const { data: agents } = await supabase
    .from("ai_agents")
    .select("slug")
    .eq("is_active", true)
    .neq("slug", "meta")
    .order("id");

  const results: AgentRunResult[] = [];
  for (const agent of agents ?? []) {
    const result = await runAgent(agent.slug, triggerType);
    results.push(result);
  }

  // Run meta agent last
  results.push(await runAgent("meta", triggerType));
  return results;
}
