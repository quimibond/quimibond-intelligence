/**
 * Daily Digest Generator — builds morning summary and queues for WhatsApp.
 *
 * Calls the Supabase RPC generate_daily_digest() which:
 *   1. Counts today's insights (new, urgent)
 *   2. Totals overdue receivables in MXN
 *   3. Computes cash position from bank balances
 *   4. Counts pending actions
 *   5. Queues a WhatsApp message to the CEO via notification_queue
 *
 * The actual delivery happens via /api/pipeline/send-notifications (every 5 min).
 *
 * Cron: daily at 7:00am (after briefing at 6:30am, before verify-follow-ups at 8am).
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    const { data, error } = await supabase.rpc("generate_daily_digest");

    if (error) {
      console.error("[daily-digest]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as Record<string, number> | null;

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "daily_digest",
      message: `Digest: ${result?.new_insights ?? 0} insights (${result?.urgent_insights ?? 0} urgent), overdue $${Math.round((result?.overdue_total ?? 0) / 1000)}K, cash $${Math.round((result?.cash_mxn ?? 0) / 1000)}K`,
      details: result,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[daily-digest]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
