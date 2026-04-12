/**
 * Retention cleanup — prevents table bloat from accumulating logs.
 *
 * Deletes/archives:
 *   - pipeline_logs older than 30 days (except errors — keep 90 days)
 *   - token_usage older than 60 days
 *   - agent_memory with times_used=0 and older than 90 days
 *   - agent_insights in 'archived' state older than 90 days
 *
 * Cron: weekly Sundays at 3am.
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();
  const results: Record<string, number> = {};

  try {
    // 1. Old pipeline logs (info/warning) — 30 day retention
    const { data: logs30, error: e1 } = await supabase
      .from("pipeline_logs")
      .delete()
      .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .in("level", ["info", "warning", "debug"])
      .select("id");
    if (e1) console.error("[retention] logs30", e1.message);
    results.logs_30d_deleted = logs30?.length ?? 0;

    // 2. Very old error logs — 90 day retention (errors kept longer for debugging)
    const { data: logs90 } = await supabase
      .from("pipeline_logs")
      .delete()
      .lt("created_at", new Date(Date.now() - 90 * 86400_000).toISOString())
      .eq("level", "error")
      .select("id");
    results.error_logs_90d_deleted = logs90?.length ?? 0;

    // 3. Token usage — 60 day retention
    const { data: tokens } = await supabase
      .from("token_usage")
      .delete()
      .lt("created_at", new Date(Date.now() - 60 * 86400_000).toISOString())
      .select("id");
    results.token_usage_60d_deleted = tokens?.length ?? 0;

    // 4. Unused agent memories — 90 days old with times_used=0
    const { data: mems } = await supabase
      .from("agent_memory")
      .delete()
      .lt("created_at", new Date(Date.now() - 90 * 86400_000).toISOString())
      .eq("times_used", 0)
      .select("id");
    results.unused_memories_deleted = mems?.length ?? 0;

    // 5. Very old archived insights — 90 days in archived state
    const { data: archived } = await supabase
      .from("agent_insights")
      .delete()
      .lt("updated_at", new Date(Date.now() - 90 * 86400_000).toISOString())
      .eq("state", "archived")
      .select("id");
    results.archived_insights_deleted = archived?.length ?? 0;

    // Log
    const total = Object.values(results).reduce((s, n) => s + n, 0);
    if (total > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "retention",
        message: `Retention cleanup: ${total} rows deleted`,
        details: results,
      });
    }

    return NextResponse.json({ success: true, total_deleted: total, ...results });
  } catch (err) {
    console.error("[retention]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
