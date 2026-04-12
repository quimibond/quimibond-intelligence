/**
 * Cron Health Monitor — Detects stale or failed pipeline runs.
 *
 * Checks each cron job to ensure it ran recently. If a job hasn't run
 * in 2x its expected interval, it's flagged as stale.
 *
 * Can be called manually or by an external uptime monitor.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 30;

// Expected intervals for each cron job (in minutes)
const CRON_INTERVALS: Record<string, number> = {
  "sync_emails": 30,
  "analyze": 5,
  "auto_fix": 30,
  "orchestrate": 30,
  "cleanup": 30,
  "validate": 30,
  "learn": 240,
  "health_scores": 360,
  "briefing": 1440,
  "reconcile": 1440,
  "embeddings": 240,
  "identity_resolution": 120,
};

interface CronStatus {
  name: string;
  last_run: string | null;
  minutes_ago: number | null;
  expected_interval: number;
  status: "ok" | "stale" | "never_run";
}

export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;  const supabase = getServiceClient();

  try {
    // Get the latest pipeline_log entry for each phase
    const { data: logs } = await supabase
      .from("pipeline_logs")
      .select("phase, created_at, level, message")
      .order("created_at", { ascending: false })
      .limit(500);

    const now = Date.now();
    const latestByPhase = new Map<string, { created_at: string; level: string; message: string }>();

    for (const log of logs ?? []) {
      const phase = (log.phase ?? "").toLowerCase().replace(/[^a-z_]/g, "_");
      if (!latestByPhase.has(phase)) {
        latestByPhase.set(phase, log);
      }
    }

    const statuses: CronStatus[] = [];
    let staleCount = 0;
    let failedCount = 0;

    for (const [name, intervalMinutes] of Object.entries(CRON_INTERVALS)) {
      const latest = latestByPhase.get(name);
      if (!latest) {
        statuses.push({
          name,
          last_run: null,
          minutes_ago: null,
          expected_interval: intervalMinutes,
          status: "never_run",
        });
        staleCount++;
        continue;
      }

      const minutesAgo = Math.round((now - new Date(latest.created_at).getTime()) / 60000);
      const isStale = minutesAgo > intervalMinutes * 2.5;

      if (isStale) staleCount++;
      if (latest.level === "error") failedCount++;

      statuses.push({
        name,
        last_run: latest.created_at,
        minutes_ago: minutesAgo,
        expected_interval: intervalMinutes,
        status: isStale ? "stale" : "ok",
      });
    }

    // Get recent errors
    const { data: recentErrors } = await supabase
      .from("pipeline_logs")
      .select("phase, message, created_at")
      .eq("level", "error")
      .order("created_at", { ascending: false })
      .limit(10);

    // Overall health
    const healthy = staleCount === 0 && failedCount === 0;

    // If unhealthy, log an alert
    if (!healthy) {
      const staleNames = statuses.filter(s => s.status !== "ok").map(s => s.name);
      await supabase.from("pipeline_logs").insert({
        level: "warning",
        phase: "health_check",
        message: `Health check: ${staleCount} stale crons, ${failedCount} recent errors. Stale: ${staleNames.join(", ")}`,
        details: { stale_count: staleCount, failed_count: failedCount, stale_crons: staleNames },
      });
    }

    return NextResponse.json({
      healthy,
      stale_count: staleCount,
      failed_count: failedCount,
      crons: statuses,
      recent_errors: recentErrors ?? [],
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[health] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
