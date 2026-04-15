/**
 * Data Cleanup — purges stale dismissed/expired data to keep tables lean.
 *
 * Calls the Supabase RPC cleanup_stale_data() which:
 *   - Deletes dismissed action_items older than 7 days
 *   - Deletes expired action_items older than 14 days
 *   - Deletes expired agent_insights older than 14 days
 *   - Deletes pipeline_logs older than 30 days
 *   - Deletes sent/failed notifications older than 7 days
 *
 * Cron: daily at 2:00am (low traffic).
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
    const { data, error } = await supabase.rpc("cleanup_stale_data");

    if (error) {
      console.error("[cleanup-data]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as Record<string, number> | null;
    const totalPurged =
      (result?.actions_purged ?? 0) +
      (result?.insights_purged ?? 0) +
      (result?.logs_purged ?? 0) +
      (result?.notifications_purged ?? 0);

    if (totalPurged > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "cleanup_data",
        message: `Cleanup: ${totalPurged} rows purged (actions=${result?.actions_purged}, insights=${result?.insights_purged}, logs=${result?.logs_purged}, notifications=${result?.notifications_purged})`,
        details: result,
      });
    }

    return NextResponse.json({ success: true, total_purged: totalPurged, ...result });
  } catch (err) {
    console.error("[cleanup-data]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
