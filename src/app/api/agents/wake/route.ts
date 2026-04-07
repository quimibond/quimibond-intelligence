/**
 * Wake Agent — Event-driven agent execution.
 *
 * Instead of waiting for the next cron cycle, this endpoint wakes a specific
 * agent immediately in response to an event (CFDI cancelled, invoice paid,
 * email from critical company, etc).
 *
 * Can be called by:
 * - Supabase Edge Functions (via webhook)
 * - Other API routes (post-save hooks)
 * - Manual trigger from /system page
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const { agent_slug, reason, context } = body as {
    agent_slug?: string;
    reason?: string;
    context?: Record<string, unknown>;
  };

  if (!agent_slug) {
    return NextResponse.json({ error: "agent_slug required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase = createClient(url, key);

  try {
    // Find the agent
    const { data: agent } = await supabase
      .from("ai_agents")
      .select("id, slug, name")
      .eq("slug", agent_slug)
      .eq("is_active", true)
      .single();

    if (!agent) {
      return NextResponse.json({ error: `Agent ${agent_slug} not found or inactive` }, { status: 404 });
    }

    // Check if agent ran in the last 5 minutes (prevent spam)
    const { data: recentRun } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("agent_id", agent.id)
      .gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .limit(1);

    if (recentRun?.length) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Agent ran in last 5 minutes, skipping to prevent spam",
      });
    }

    // Call the orchestrate endpoint internally to run this specific agent
    const origin = request.headers.get("origin") ?? request.nextUrl.origin;
    const cronSecret = process.env.CRON_SECRET;

    const res = await fetch(`${origin}/api/agents/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ agent_slug }),
    });

    const result = await res.json();

    // Log the wake event
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "agent_wake",
      message: `Agent ${agent.name} woken by event: ${reason ?? "manual"}`,
      details: { agent_slug, reason, context, result },
    });

    return NextResponse.json({
      success: true,
      agent: agent.slug,
      reason,
      result,
    });
  } catch (err) {
    console.error("[wake] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
