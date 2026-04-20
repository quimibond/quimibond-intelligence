/**
 * Daily Snapshot — Captures the financial/operational state of every company.
 *
 * Run once per day at 5:30am (before briefing at 6:30am).
 * Agents can then compare "today vs 7 days ago" to detect trends.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;  const supabase = getServiceClient();

  try {
    const { data, error } = await supabase.rpc("take_daily_snapshot");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log it
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "daily_snapshot",
      message: `Snapshot: ${data?.companies_snapshotted ?? 0} companies`,
      details: data,
    });

    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error("[snapshot] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
