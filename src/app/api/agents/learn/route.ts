/**
 * Agent Learning Pipeline — Makes agents smarter over time.
 *
 * Runs after orchestration (or on cron). Three mechanisms:
 *
 * 1. FEEDBACK ANALYSIS
 *    - Tracks which insights got acted_on vs dismissed
 *    - Calculates acceptance rate per agent and per insight_type
 *    - Identifies patterns: what does the CEO care about?
 *
 * 2. MEMORY CREATION
 *    - Converts high-signal feedback into agent memories
 *    - "CEO acted on payment risk insights 90% of the time"
 *    - "CEO dismissed low-severity operational insights"
 *    - Memories persist between runs, loaded into agent context
 *
 * 3. AUTO-CALIBRATION (via Meta Agent)
 *    - Adjusts confidence thresholds per agent
 *    - Suggests prompt refinements for underperforming agents
 *    - Tracks prediction accuracy (did the risk actually happen?)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

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

  try {
    // ── 1. FEEDBACK ANALYSIS ────────────────────────────────────────────

    // Get all insights with feedback (acted_on or dismissed)
    const { data: feedbackInsights } = await supabase
      .from("agent_insights")
      .select("id, agent_id, insight_type, category, severity, confidence, state, was_useful, title, recommendation, created_at")
      .in("state", ["acted_on", "dismissed"])
      .order("created_at", { ascending: false })
      .limit(200);

    // Get agent definitions
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("id, slug, name, domain")
      .eq("is_active", true);

    if (!feedbackInsights?.length || !agents?.length) {
      return NextResponse.json({ success: true, message: "Not enough feedback data yet", memories_created: 0 });
    }

    // Calculate acceptance rates per agent
    const agentStats = new Map<number, {
      slug: string;
      total: number;
      acted: number;
      dismissed: number;
      byType: Map<string, { acted: number; dismissed: number }>;
      bySeverity: Map<string, { acted: number; dismissed: number }>;
    }>();

    for (const agent of agents) {
      agentStats.set(agent.id, {
        slug: agent.slug,
        total: 0,
        acted: 0,
        dismissed: 0,
        byType: new Map(),
        bySeverity: new Map(),
      });
    }

    for (const insight of feedbackInsights) {
      const stats = agentStats.get(insight.agent_id);
      if (!stats) continue;

      stats.total++;
      const isPositive = insight.state === "acted_on";
      if (isPositive) stats.acted++;
      else stats.dismissed++;

      // By type
      const typeKey = insight.insight_type ?? "unknown";
      if (!stats.byType.has(typeKey)) stats.byType.set(typeKey, { acted: 0, dismissed: 0 });
      const typeStats = stats.byType.get(typeKey)!;
      if (isPositive) typeStats.acted++;
      else typeStats.dismissed++;

      // By severity
      const sevKey = insight.severity ?? "unknown";
      if (!stats.bySeverity.has(sevKey)) stats.bySeverity.set(sevKey, { acted: 0, dismissed: 0 });
      const sevStats = stats.bySeverity.get(sevKey)!;
      if (isPositive) sevStats.acted++;
      else sevStats.dismissed++;
    }

    // ── 2. MEMORY CREATION ──────────────────────────────────────────────

    let memoriesCreated = 0;

    for (const [agentId, stats] of agentStats) {
      if (stats.total < 3) continue; // Need minimum data

      const acceptanceRate = stats.total > 0 ? stats.acted / stats.total : 0;

      // Create memory about overall performance
      await upsertMemory(supabase, agentId, "performance",
        `Mi tasa de aceptacion es ${(acceptanceRate * 100).toFixed(0)}% (${stats.acted} actuados, ${stats.dismissed} descartados de ${stats.total} total).`,
        acceptanceRate > 0.5 ? 0.6 : 0.9 // Higher importance if performing poorly
      );
      memoriesCreated++;

      // Create memories about what types work best
      for (const [type, typeStats] of stats.byType) {
        const total = typeStats.acted + typeStats.dismissed;
        if (total < 2) continue;
        const rate = typeStats.acted / total;

        if (rate >= 0.7) {
          await upsertMemory(supabase, agentId, "pattern",
            `El CEO actua en mis insights de tipo "${type}" el ${(rate * 100).toFixed(0)}% del tiempo. Seguir generando estos.`,
            0.8
          );
          memoriesCreated++;
        } else if (rate <= 0.3) {
          await upsertMemory(supabase, agentId, "pattern",
            `El CEO descarta mis insights de tipo "${type}" el ${((1 - rate) * 100).toFixed(0)}% del tiempo. Reducir estos o mejorar la calidad.`,
            0.9
          );
          memoriesCreated++;
        }
      }

      // Create memories about severity preferences
      for (const [sev, sevStats] of stats.bySeverity) {
        const total = sevStats.acted + sevStats.dismissed;
        if (total < 2) continue;
        const rate = sevStats.acted / total;

        if (sev === "info" && rate < 0.3) {
          await upsertMemory(supabase, agentId, "calibration",
            `Los insights de severidad "info" se descartan ${((1 - rate) * 100).toFixed(0)}% del tiempo. Subir el umbral minimo a "low" o "medium".`,
            0.85
          );
          memoriesCreated++;
        }
        if (sev === "low" && rate < 0.3) {
          await upsertMemory(supabase, agentId, "calibration",
            `Los insights de severidad "low" se descartan frecuentemente. Enfocarse en medium+ o ser mas selectivo.`,
            0.85
          );
          memoriesCreated++;
        }
      }
    }

    // ── 3. AUTO-CALIBRATION (Meta Agent reflection) ─────────────────────

    // Build a summary for the meta agent to reflect on
    const agentSummaries = [...agentStats.entries()].map(([id, stats]) => ({
      agent: stats.slug,
      acceptance_rate: stats.total > 0 ? `${(stats.acted / stats.total * 100).toFixed(0)}%` : "n/a",
      total: stats.total,
      best_types: [...stats.byType.entries()]
        .filter(([, s]) => s.acted + s.dismissed >= 2)
        .sort((a, b) => (b[1].acted / (b[1].acted + b[1].dismissed)) - (a[1].acted / (a[1].acted + a[1].dismissed)))
        .slice(0, 2)
        .map(([type, s]) => `${type}: ${(s.acted / (s.acted + s.dismissed) * 100).toFixed(0)}%`),
      worst_types: [...stats.byType.entries()]
        .filter(([, s]) => s.acted + s.dismissed >= 2)
        .sort((a, b) => (a[1].acted / (a[1].acted + a[1].dismissed)) - (b[1].acted / (b[1].acted + b[1].dismissed)))
        .slice(0, 2)
        .map(([type, s]) => `${type}: ${(s.acted / (s.acted + s.dismissed) * 100).toFixed(0)}%`),
    }));

    // Only call Claude for meta-reflection if we have enough data
    let metaLessons: string[] = [];
    const totalFeedback = feedbackInsights.length;

    if (totalFeedback >= 10) {
      try {
        const { result } = await callClaudeJSON<{ lessons: string[] }>(
          apiKey,
          {
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            temperature: 0.2,
            system: "Eres el meta-agente de Quimibond Intelligence. Analiza el rendimiento de los agentes y genera lecciones para mejorar. Responde en espanol con JSON: {lessons: [string]}",
            messages: [{
              role: "user",
              content: `Rendimiento de agentes basado en ${totalFeedback} interacciones del CEO:\n\n${JSON.stringify(agentSummaries, null, 2)}\n\nGenera 3-5 lecciones concretas para mejorar el sistema. Cada leccion debe ser accionable.`,
            }],
          },
          "agent-meta-learn"
        );
        metaLessons = result.lessons ?? [];

        // Save meta lessons as memories for the meta agent
        const metaAgent = agents.find(a => a.slug === "meta");
        if (metaAgent) {
          for (const lesson of metaLessons) {
            await upsertMemory(supabase, metaAgent.id, "lesson", lesson, 0.9);
            memoriesCreated++;
          }
        }
      } catch (err) {
        console.error("[learn] Meta reflection failed:", err);
      }
    }

    // ── 4. DECAY OLD MEMORIES ───────────────────────────────────────────

    // Reduce importance of old memories that haven't been used
    await supabase
      .from("agent_memory")
      .update({ importance: 0.3 })
      .lt("updated_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .eq("times_used", 0);

    // Delete expired memories
    await supabase
      .from("agent_memory")
      .delete()
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());

    // Log
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "agent_learning",
      message: `Learning: ${memoriesCreated} memories created from ${totalFeedback} feedback signals`,
      details: {
        feedback_analyzed: totalFeedback,
        memories_created: memoriesCreated,
        meta_lessons: metaLessons,
        agent_summaries: agentSummaries,
      },
    });

    return NextResponse.json({
      success: true,
      feedback_analyzed: totalFeedback,
      memories_created: memoriesCreated,
      meta_lessons: metaLessons,
      agent_stats: agentSummaries,
    });
  } catch (err) {
    console.error("[learn] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helper: Upsert memory ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertMemory(supabase: any, agentId: number, memoryType: string, content: string, importance: number) {
  // Check if similar memory exists
  const { data: existing } = await supabase
    .from("agent_memory")
    .select("id")
    .eq("agent_id", agentId)
    .eq("memory_type", memoryType)
    .ilike("content", `%${content.slice(0, 50)}%`)
    .limit(1);

  if (existing?.length) {
    // Update existing
    await supabase
      .from("agent_memory")
      .update({ content, importance, updated_at: new Date().toISOString(), times_used: 0 })
      .eq("id", existing[0].id);
  } else {
    // Create new
    await supabase
      .from("agent_memory")
      .insert({
        agent_id: agentId,
        memory_type: memoryType,
        content,
        importance,
        expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(), // 90 day expiry
      });
  }
}
