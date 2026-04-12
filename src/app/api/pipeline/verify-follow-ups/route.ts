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
    const { data, error } = await supabase.rpc("verify_follow_ups");
    if (error) {
      console.error("[verify-follow-ups]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as Record<string, number>;
    if ((result?.processed ?? 0) > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "follow_up_verification",
        message: `Follow-ups: ${result.processed} verified (${result.improved} improved, ${result.unchanged} unchanged, ${result.worsened} worsened)`,
        details: result,
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[verify-follow-ups]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
