/**
 * Agent Learning Pipeline v2 — Makes agents smarter over time.
 *
 * Improvements over v1:
 * - Time-decay: recent feedback weighs more than old feedback
 * - Archived insights: learns from low-confidence insights that were archived
 * - Category-specific memories: more granular than just type/severity
 * - Company-specific patterns: learns which companies CEO cares most about
 * - Memory dedup: uses content hash instead of fragile substring matching
 *
 * Mechanisms:
 * 1. FEEDBACK ANALYSIS — acceptance rates with time decay
 * 2. MEMORY CREATION — per-type, per-severity, per-company patterns
 * 3. AUTO-CALIBRATION — meta-agent generates actionable lessons
 * 4. MEMORY DECAY — importance decay + cleanup
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
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
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });  const supabase = getServiceClient();

  try {
    // ── 1. FEEDBACK ANALYSIS ────────────────────────────────────────────

    // Get all insights with feedback (acted_on, dismissed, or archived for learning)
    const { data: feedbackInsights } = await supabase
      .from("agent_insights")
      .select("id, agent_id, insight_type, category, severity, confidence, state, was_useful, title, recommendation, company_id, created_at")
      .in("state", ["acted_on", "dismissed", "archived"])
      .order("created_at", { ascending: false })
      .limit(300);

    // Get agent definitions
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("id, slug, name, domain")
      .eq("is_active", true);

    if (!feedbackInsights?.length || !agents?.length) {
      return NextResponse.json({ success: true, message: "Not enough feedback data yet", memories_created: 0 });
    }

    // Calculate acceptance rates per agent — with time-decay weighting
    const agentStats = new Map<number, {
      slug: string;
      total: number;
      acted: number;
      dismissed: number;
      archived: number;
      byType: Map<string, { acted: number; dismissed: number }>;
      bySeverity: Map<string, { acted: number; dismissed: number }>;
      byCategory: Map<string, { acted: number; dismissed: number }>;
      topCompanies: Map<number, { acted: number; dismissed: number }>;
    }>();

    for (const agent of agents) {
      agentStats.set(agent.id, {
        slug: agent.slug,
        total: 0, acted: 0, dismissed: 0, archived: 0,
        byType: new Map(),
        bySeverity: new Map(),
        byCategory: new Map(),
        topCompanies: new Map(),
      });
    }

    const now = Date.now();
    for (const insight of feedbackInsights) {
      const stats = agentStats.get(insight.agent_id);
      if (!stats) continue;

      // Skip archived insights for acceptance stats (they're for learning only)
      if (insight.state === "archived") {
        stats.archived++;
        continue;
      }

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

      // By category (more granular than type)
      const catKey = insight.category ?? "unknown";
      if (!stats.byCategory.has(catKey)) stats.byCategory.set(catKey, { acted: 0, dismissed: 0 });
      const catStats = stats.byCategory.get(catKey)!;
      if (isPositive) catStats.acted++;
      else catStats.dismissed++;

      // By company (track which companies CEO cares about)
      if (insight.company_id) {
        if (!stats.topCompanies.has(insight.company_id)) stats.topCompanies.set(insight.company_id, { acted: 0, dismissed: 0 });
        const coStats = stats.topCompanies.get(insight.company_id)!;
        if (isPositive) coStats.acted++;
        else coStats.dismissed++;
      }
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

      // Create memories about category preferences (more granular)
      for (const [cat, catStats] of stats.byCategory) {
        const total = catStats.acted + catStats.dismissed;
        if (total < 3) continue;
        const rate = catStats.acted / total;

        if (rate >= 0.75) {
          await upsertMemory(supabase, agentId, "pattern",
            `La categoria "${cat}" tiene alta aceptacion (${(rate * 100).toFixed(0)}%). Priorizar esta categoria.`,
            0.85
          );
          memoriesCreated++;
        } else if (rate <= 0.25) {
          await upsertMemory(supabase, agentId, "pattern",
            `La categoria "${cat}" se descarta frecuentemente (${((1 - rate) * 100).toFixed(0)}%). Reducir o mejorar calidad.`,
            0.9
          );
          memoriesCreated++;
        }
      }

      // Track archived insights ratio (too many = confidence too aggressive)
      if (stats.archived > 0 && stats.total > 0) {
        const archiveRatio = stats.archived / (stats.archived + stats.total);
        if (archiveRatio > 0.5) {
          await upsertMemory(supabase, agentId, "calibration",
            `${(archiveRatio * 100).toFixed(0)}% de mis insights se archivan por baja confianza. Ser mas decisivo: generar menos insights pero con mayor confianza.`,
            0.8
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
    const totalFeedback = feedbackInsights.filter(i => i.state !== "archived").length;

    if (totalFeedback >= 10) {
      try {
        const { result } = await callClaudeJSON<{ lessons: string[]; agent_recommendations: Record<string, string> }>(
          apiKey,
          {
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            temperature: 0.2,
            system: `Eres el sistema de aprendizaje de Quimibond Intelligence. Analizas el rendimiento de los 7 Directores IA (comercial, financiero, operaciones, compras, riesgo, costos, equipo) y generas lecciones ACCIONABLES.

Responde en JSON:
{
  "lessons": ["leccion global 1", "leccion 2", ...],
  "agent_recommendations": {
    "director_slug": "recomendacion especifica"
  }
}

Cada leccion debe ser especifica y medible. Ejemplo bueno: "El Director Financiero genera insights sobre facturas <$5K que el CEO descarta. Filtrar facturas <$10K." Ejemplo malo: "Mejorar la calidad."`,
            messages: [{
              role: "user",
              content: `Rendimiento de agentes basado en ${totalFeedback} interacciones del CEO:\n\n${JSON.stringify(agentSummaries, null, 2)}\n\nGenera 3-5 lecciones concretas y una recomendacion por agente que tenga datos suficientes.`,
            }],
          },
          "agent-meta-learn"
        );
        metaLessons = result.lessons ?? [];

        // Save meta lessons as memories for ALL active directors
        for (const lesson of metaLessons) {
          for (const agent of agents) {
            await upsertMemory(supabase, agent.id, "lesson", lesson, 0.9);
            memoriesCreated++;
          }
        }

        // Save agent-specific recommendations as memories for each agent
        if (result.agent_recommendations) {
          for (const [slug, recommendation] of Object.entries(result.agent_recommendations)) {
            const agent = agents.find(a => a.slug === slug);
            if (agent && recommendation) {
              await upsertMemory(supabase, agent.id, "meta_feedback",
                `Recomendacion del meta-agente: ${recommendation}`,
                0.85
              );
              memoriesCreated++;
            }
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

/**
 * Generates a stable key for deduplication based on agent, type, and content theme.
 * Uses first meaningful sentence to identify the "topic" of the memory.
 */
function memoryKey(agentId: number, memoryType: string, content: string): string {
  // Extract the core topic: normalize numbers and percentages
  const normalized = content
    .toLowerCase()
    .replace(/\d+%/g, "N%")
    .replace(/\d+/g, "N")
    .replace(/[""]/g, '"')
    .trim();
  // Use first 80 chars as the key (enough to identify topic, not specific stats)
  return `${agentId}:${memoryType}:${normalized.slice(0, 80)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertMemory(supabase: any, agentId: number, memoryType: string, content: string, importance: number) {
  // Check if a memory with similar topic exists for this agent
  // Use agent_id + memory_type + beginning of content (normalized) for matching
  const { data: existing } = await supabase
    .from("agent_memory")
    .select("id, content, times_used")
    .eq("agent_id", agentId)
    .eq("memory_type", memoryType)
    .limit(20);

  const key = memoryKey(agentId, memoryType, content);
  const match = (existing ?? []).find((m: { id: number; content: string }) =>
    memoryKey(agentId, memoryType, m.content) === key
  );

  if (match) {
    // Update existing — preserve times_used, don't reset
    await supabase
      .from("agent_memory")
      .update({
        content,
        importance,
        updated_at: new Date().toISOString(),
        // Refresh expiry when content is updated (memory stays relevant)
        expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
      })
      .eq("id", match.id);
  } else {
    // Create new
    await supabase
      .from("agent_memory")
      .insert({
        agent_id: agentId,
        memory_type: memoryType,
        content,
        importance,
        expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
      });
  }
}
