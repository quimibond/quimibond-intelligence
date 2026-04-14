/**
 * Run a single agent or all agents.
 * Delegates to the orchestrator which has all context builders.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_slug, run_all } = body as { agent_slug?: string; run_all?: boolean };

    if (run_all) {
      const origin = request.nextUrl.origin;
      const res = await fetch(`${origin}/api/agents/orchestrate`, { method: "POST" });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (!agent_slug) {
      return NextResponse.json({ error: "agent_slug required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });    const supabase = getServiceClient();

    // Load agent definition
    const { data: agent } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("slug", agent_slug)
      .single();

    if (!agent) return NextResponse.json({ error: `Agent '${agent_slug}' not found` }, { status: 404 });

    // Create run record
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({ agent_id: agent.id, status: "running", trigger_type: "manual" })
      .select("id")
      .single();
    const runId = run?.id;
    const startTime = Date.now();

    try {
      // Dynamic import of orchestrator's getDomainData
      const orchModule = await import("@/app/api/agents/orchestrate/route");
      // We need the getDomainData function - but it's not exported
      // So we build context inline using the same pattern

      const context = await buildContext(supabase, agent.domain);

      // Load memories
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
          system: agent.system_prompt + `\n\nIMPORTANTE: Solo genera insights que realmente importen. Si no hay nada importante, devuelve [].`,
          messages: [{
            role: "user",
            content: `Analiza estos datos y genera insights accionables.\n\n${context}${memoryText}\n\nResponde con JSON array. Cada insight:\n- title, description, insight_type, category, severity, confidence (0-1), recommendation, business_impact_estimate (null si no aplica), evidence (array), company_name (null si general), contact_email (null si no aplica)`,
          }],
        },
        `agent-${agent.slug}`
      );

      const insights = Array.isArray(result) ? result : [];

      // Resolve company names to IDs and write insights
      if (insights.length > 0) {
        // Quality filter: drop insights with impact < $50K unless severity=critical
        // This cuts noise to the CEO drastically (50% of insights had no impact score)
        const MIN_IMPACT = 50000;
        const filtered = insights.filter(i => {
          const severity = String(i.severity || "info").toLowerCase();
          if (severity === "critical") return true;
          const impact = Number(i.business_impact_estimate) || 0;
          return impact >= MIN_IMPACT;
        });

        // Sort by impact and cap at 5 per run to force quality over quantity
        filtered.sort((a, b) =>
          (Number(b.business_impact_estimate) || 0) -
          (Number(a.business_impact_estimate) || 0)
        );
        const topInsights = filtered.slice(0, 5);

        const rows = [];
        for (const i of topInsights) {
          let companyId: number | null = null;
          if (i.company_name) {
            const { data: co } = await supabase
              .from("companies")
              .select("id")
              .ilike("canonical_name", String(i.company_name).trim())
              .limit(1)
              .single();
            if (co) companyId = co.id;
          }

          // Dedup: check if same agent already has an open insight for this
          // company with a similar title in the last 7 days. Skip if so.
          const normalizedTitle = String(i.title || "")
            .toLowerCase().trim().slice(0, 60);
          if (normalizedTitle && companyId) {
            const { data: existing } = await supabase
              .from("agent_insights")
              .select("id")
              .eq("agent_id", agent.id)
              .eq("company_id", companyId)
              .in("state", ["new", "seen"])
              .ilike("title", `${normalizedTitle}%`)
              .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
              .limit(1)
              .maybeSingle();
            if (existing) continue; // skip duplicate
          }

          rows.push({
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
            state: "new",
          });
        }
        if (rows.length > 0) {
          await supabase.from("agent_insights").insert(rows);
        }
        console.log(`[agent-run] ${agent.name}: ${insights.length} raw → ${filtered.length} filtered → ${rows.length} inserted (${insights.length - rows.length} dropped)`);
      }

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

      return NextResponse.json({ ok: true, result: { run_id: runId, status: "completed", insights_generated: insights.length, duration_seconds: duration } });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (runId) {
        await supabase.from("agent_runs").update({
          status: "failed", completed_at: new Date().toISOString(), error_message: errMsg,
        }).eq("id", runId);
      }
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Context builder (same as orchestrator) ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildContext(supabase: any, domain: string): Promise<string> {
  switch (domain) {
    case "sales": {
      const [orders, leads, topClients] = await Promise.all([
        supabase.from("odoo_order_lines").select("company_id, product_name, subtotal_mxn, order_date").eq("order_type", "sale").order("order_date", { ascending: false }).limit(30),
        supabase.from("odoo_crm_leads").select("*").eq("active", true),
        supabase.from("companies").select("id, name, lifetime_value, trend_pct").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(15),
      ]);
      return `## Ventas\n${JSON.stringify(orders.data?.slice(0, 20))}\n\n## CRM\n${JSON.stringify(leads.data)}\n\n## Top clientes\n${JSON.stringify(topClients.data)}`;
    }
    case "finance": {
      const [invoices, overdue] = await Promise.all([
        supabase.from("odoo_invoices").select("company_id, amount_total_mxn, amount_residual_mxn, payment_state, days_overdue").eq("move_type", "out_invoice").order("days_overdue", { ascending: false }).limit(30),
        supabase.from("companies").select("id, name, total_pending, lifetime_value").not("total_pending", "is", null).gt("total_pending", 0).order("total_pending", { ascending: false }).limit(20),
      ]);
      return `## Facturas\n${JSON.stringify(invoices.data)}\n\n## Empresas con saldo\n${JSON.stringify(overdue.data)}`;
    }
    case "operations": {
      const [deliveries, products] = await Promise.all([
        supabase.from("odoo_deliveries").select("company_id, name, state, is_late, scheduled_date").order("scheduled_date", { ascending: false }).limit(30),
        supabase.from("odoo_products").select("name, stock_qty, available_qty, reorder_min").gt("reorder_min", 0).order("available_qty", { ascending: true }).limit(20),
      ]);
      return `## Entregas\n${JSON.stringify(deliveries.data)}\n\n## Inventario critico\n${JSON.stringify(products.data)}`;
    }
    case "relationships": {
      const [contacts, threads] = await Promise.all([
        supabase.from("contacts").select("id, name, email, risk_level, sentiment_score, current_health_score, last_activity").eq("contact_type", "external").order("current_health_score", { ascending: true, nullsFirst: false }).limit(20),
        supabase.from("threads").select("subject, status, hours_without_response, company_id").in("status", ["needs_response", "stalled"]).limit(15),
      ]);
      return `## Contactos\n${JSON.stringify(contacts.data)}\n\n## Threads sin respuesta\n${JSON.stringify(threads.data)}`;
    }
    case "risk": {
      const [overdueInv, atRisk] = await Promise.all([
        supabase.from("odoo_invoices").select("company_id, amount_residual_mxn, days_overdue").gt("days_overdue", 30).eq("move_type", "out_invoice").order("amount_residual_mxn", { ascending: false }).limit(15),
        supabase.from("contacts").select("id, name, risk_level, current_health_score").in("risk_level", ["high", "critical"]).limit(15),
      ]);
      return `## Facturas vencidas\n${JSON.stringify(overdueInv.data)}\n\n## Contactos en riesgo\n${JSON.stringify(atRisk.data)}`;
    }
    case "growth": {
      const [topClients] = await Promise.all([
        supabase.from("companies").select("id, name, lifetime_value, trend_pct").eq("is_customer", true).not("lifetime_value", "is", null).order("lifetime_value", { ascending: false }).limit(20),
      ]);
      return `## Top clientes\n${JSON.stringify(topClients.data)}`;
    }
    case "data_quality": {
      const checks = await Promise.all([
        supabase.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null),
        supabase.from("emails").select("id", { count: "exact", head: true }).is("company_id", null),
        supabase.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", false),
        supabase.from("emails").select("id", { count: "exact", head: true }),
        supabase.from("contacts").select("id", { count: "exact", head: true }).is("name", null),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("odoo_invoices").select("id", { count: "exact", head: true }).is("company_id", null),
        supabase.from("odoo_order_lines").select("id", { count: "exact", head: true }).is("company_id", null),
      ]);
      return `## Data Quality\n- Emails sin contacto: ${checks[0].count}/${checks[3].count}\n- Emails sin empresa: ${checks[1].count}\n- Emails sin procesar: ${checks[2].count}\n- Contactos sin nombre: ${checks[4].count}/${checks[5].count}\n- Empresas sin entity: ${checks[6].count}/${checks[7].count}\n- Invoices sin company: ${checks[8].count}\n- Orders sin company: ${checks[9].count}`;
    }
    case "odoo": {
      const [users, products, orders, invoices, deliveries, leads, activities] = await Promise.all([
        supabase.from("odoo_users").select("id", { count: "exact", head: true }),
        supabase.from("odoo_products").select("id", { count: "exact", head: true }),
        supabase.from("odoo_order_lines").select("id", { count: "exact", head: true }),
        supabase.from("odoo_invoices").select("id", { count: "exact", head: true }),
        supabase.from("odoo_deliveries").select("id", { count: "exact", head: true }),
        supabase.from("odoo_crm_leads").select("id", { count: "exact", head: true }),
        supabase.from("odoo_activities").select("id", { count: "exact", head: true }),
      ]);
      return `## Odoo Sync Status\n- Users: ${users.count}\n- Products: ${products.count}\n- Orders: ${orders.count}\n- Invoices: ${invoices.count}\n- Deliveries: ${deliveries.count}\n- CRM: ${leads.count}\n- Activities: ${activities.count}\n\n## No sincronizado\nhr.employee, hr.department, account.payment.term, res.partner.category, mail.message, mrp.bom, sale.order headers, purchase.order headers`;
    }
    case "meta": {
      const [runs, insights] = await Promise.all([
        supabase.from("agent_runs").select("agent_id, status, insights_generated").order("started_at", { ascending: false }).limit(20),
        supabase.from("agent_insights").select("agent_id, severity, state, confidence, was_useful").order("created_at", { ascending: false }).limit(30),
      ]);
      return `## Runs\n${JSON.stringify(runs.data)}\n\n## Insights\n${JSON.stringify(insights.data)}`;
    }
    default:
      return "";
  }
}
