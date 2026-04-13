/**
 * Follow-up verifier — checks insight follow_ups whose date has passed.
 *
 * For each insight the CEO marked as 'acted_on', the trigger
 * create_follow_up_on_action creates a follow_up row with a snapshot
 * of the company's metrics (overdue, late_deliveries, etc).
 *
 * This cron runs verify_follow_ups() which compares the snapshot with
 * current metrics and marks the follow-up as improved/unchanged/worsened.
 *
 * This is the ROI proof mechanism — we can show the CEO:
 * "Of the 20 insights you acted on last month, 15 improved the metric,
 *  3 unchanged, 2 worsened."
 *
 * Cron: once daily at 8am (after 7am briefing).
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Step 1: Run the original verify_follow_ups (legacy)
    const { data, error } = await supabase.rpc("verify_follow_ups");
    if (error) {
      console.error("[verify-follow-ups] verify_follow_ups:", error.message);
    }

    const result = (data ?? {}) as Record<string, number>;

    // Step 2: Run the new resolve_pending_follow_ups which also feeds
    // results back to agent_memory (feedback loop for agent learning)
    let resolveResult: Record<string, number> = {};
    try {
      const { data: rData, error: rError } = await supabase.rpc("resolve_pending_follow_ups");
      if (rError) {
        console.error("[verify-follow-ups] resolve_pending:", rError.message);
      } else {
        resolveResult = (rData ?? {}) as Record<string, number>;
      }
    } catch (resolveErr) {
      console.error("[verify-follow-ups] resolve_pending:", resolveErr);
    }

    const totalProcessed = (result?.processed ?? 0) + (resolveResult?.total_evaluated ?? 0);
    if (totalProcessed > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "follow_up_verification",
        message: `Follow-ups: ${result.processed ?? 0} verified + ${resolveResult.resolved ?? 0} resolved (feedback loop)`,
        details: { verify: result, resolve: resolveResult },
      });
    }

    return NextResponse.json({
      success: true,
      verify: result,
      resolve: resolveResult,
    });
  } catch (err) {
    console.error("[verify-follow-ups]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
