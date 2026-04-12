/**
 * Refresh materialized views — keeps analytics fresh for dashboard.
 *
 * Calls refresh_all_analytics() which refreshes 23 materialized views
 * (company_profile, cashflow_projection, monthly_revenue_trend, etc).
 *
 * Previously this only ran as part of take_daily_snapshot (1x/day).
 * Running every 6h keeps the dashboard fresh for the CEO without
 * overwhelming the DB.
 *
 * Cron: every 6h.
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
  const start = Date.now();

  try {
    const { data, error } = await supabase.rpc("refresh_all_analytics");
    if (error) {
      console.error("[refresh-views]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const elapsedMs = Date.now() - start;
    const result = data as Record<string, unknown>;

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "refresh_analytics",
      message: `Refreshed materialized views in ${Math.round(elapsedMs / 1000)}s`,
      details: { ...result, elapsed_ms: elapsedMs },
    });

    return NextResponse.json({
      success: true,
      elapsed_ms: elapsedMs,
      ...result,
    });
  } catch (err) {
    console.error("[refresh-views]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
