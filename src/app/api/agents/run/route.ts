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

// ── Context builder ────────────────────────────────────────────────────
// NOTE (audit 2026-04-15): the legacy sales/finance/operations/relationships/
// risk/growth/data_quality/odoo/meta switch cases were removed. Those domains
// belonged to agents that were deactivated on 2026-04-05. The active 7 directors
// (comercial, financiero, operaciones_dir, compras, costos, riesgo_dir,
// equipo_dir) route through /api/agents/orchestrate which has the full rich
// context (director briefings, memories, feedback loops, email intel, etc).
//
// This endpoint is kept as a thin shim for any legacy webhook / external caller.
// Manual UI triggers should hit /api/agents/orchestrate directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildContext(_supabase: any, _domain: string): Promise<string> {
  return "";
}
