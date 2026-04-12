/**
 * Data Quality Check — runs the data_quality_alerts() function and
 * creates insight records for critical/high alerts so they reach the CEO.
 *
 * Purpose: prevent silent data integrity regressions (like the 7-day
 * RLS insert bug we fixed). If any critical alert appears, the CEO sees
 * it in the inbox immediately.
 *
 * Cron: every 6 hours.
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
    // Run the scorecard alerts query
    const { data: alerts, error: alertsErr } = await supabase
      .rpc("data_quality_alerts");

    if (alertsErr) {
      console.error("[data-quality] alerts query failed:", alertsErr.message);
      return NextResponse.json({ error: alertsErr.message }, { status: 500 });
    }

    const alertList = (alerts as Array<{
      category: string;
      metric: string;
      value: number;
      threshold: number;
      severity: string;
      description: string;
    }>) ?? [];

    const criticals = alertList.filter(a => a.severity === "critical");
    const highs = alertList.filter(a => a.severity === "high");
    const mediums = alertList.filter(a => a.severity === "medium");

    // For each critical/high alert, create an insight (dedupped by title)
    let createdInsights = 0;
    for (const alert of [...criticals, ...highs]) {
      const title = `Data Quality: ${alert.metric.replace(/_/g, " ")} = ${alert.value} (umbral ${alert.threshold})`;

      // Skip if same insight already exists in last 24h
      const { data: existing } = await supabase
        .from("agent_insights")
        .select("id")
        .eq("category", "datos")
        .ilike("title", `Data Quality: ${alert.metric.replace(/_/g, " ")}%`)
        .in("state", ["new", "seen"])
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      // Find or create a "system" agent for these alerts
      const { data: systemAgent } = await supabase
        .from("ai_agents")
        .select("id")
        .eq("slug", "data_quality")
        .limit(1)
        .maybeSingle();

      const agentId = systemAgent?.id ?? null;
      if (!agentId) continue; // if no data_quality agent, skip

      const { error: insertErr } = await supabase.from("agent_insights").insert({
        agent_id: agentId,
        insight_type: "anomaly",
        category: "datos",
        severity: alert.severity,
        title: title.slice(0, 200),
        description: alert.description,
        evidence: [`${alert.category}: ${alert.metric} = ${alert.value}, threshold = ${alert.threshold}`],
        recommendation: `Revisar la métrica ${alert.metric}. Probablemente hay un cron roto o un sync fallando. Ver data_quality_scorecard view.`,
        confidence: 1.0,
        business_impact_estimate: null,
        state: "new",
      });

      if (!insertErr) createdInsights++;
    }

    // Log to pipeline_logs for audit
    await supabase.from("pipeline_logs").insert({
      level: criticals.length > 0 ? "warning" : "info",
      phase: "data_quality_check",
      message: `DQ check: ${criticals.length} critical, ${highs.length} high, ${mediums.length} medium alerts (${createdInsights} insights created)`,
      details: {
        critical: criticals.length,
        high: highs.length,
        medium: mediums.length,
        insights_created: createdInsights,
        alerts: alertList,
      },
    });

    return NextResponse.json({
      success: true,
      total_alerts: alertList.length,
      by_severity: {
        critical: criticals.length,
        high: highs.length,
        medium: mediums.length,
      },
      insights_created: createdInsights,
      alerts: alertList,
    });
  } catch (err) {
    console.error("[data-quality] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
