import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { synthesizeBriefing } from "@/lib/pipeline/claude-pipeline";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();
    const today = new Date().toISOString().split("T")[0];

    // Gather today's analysis data
    const [summariesRes, alertsRes, metricsRes, previousBriefingRes] = await Promise.all([
      supabase
        .from("email_analyses")
        .select("*")
        .eq("analysis_date", today),

      supabase
        .from("alerts")
        .select("*")
        .eq("state", "new")
        .order("created_at", { ascending: false })
        .limit(20),

      supabase
        .from("communication_metrics")
        .select("*")
        .order("metric_date", { ascending: false })
        .limit(10),

      supabase
        .from("briefings")
        .select("summary_text")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1),
    ]);

    const summaries = summariesRes.data ?? [];
    const alerts = alertsRes.data ?? [];
    const metrics = metricsRes.data ?? [];
    const previousSummary = previousBriefingRes.data?.[0]?.summary_text ?? "";

    if (!summaries.length && !alerts.length) {
      return NextResponse.json({
        success: true,
        message: "Sin datos para generar briefing",
      });
    }

    // Build data package for Claude
    const dataPackage = buildDataPackage(today, summaries, alerts, metrics, previousSummary);

    // Call Claude to synthesize briefing
    const briefingHtml = await synthesizeBriefing(apiKey, dataPackage);

    // Extract summary text (first 500 chars stripped of HTML)
    const summaryText = briefingHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    // Save briefing
    await supabase.from("briefings").upsert({
      briefing_date: today,
      scope: "daily",
      html_content: briefingHtml,
      summary_text: summaryText,
      total_emails: summaries.reduce((s, a) => s + ((a.summary_json as Record<string, unknown>)?.total_emails as number ?? 0), 0),
      total_alerts: alerts.length,
    }, { onConflict: "briefing_date,scope" });

    return NextResponse.json({
      success: true,
      briefing_date: today,
      summaries: summaries.length,
      alerts: alerts.length,
    });
  } catch (err) {
    console.error("[briefing] Error:", err);
    return NextResponse.json(
      { error: "Error generando briefing.", detail: String(err) },
      { status: 500 }
    );
  }
}

function buildDataPackage(
  today: string,
  summaries: Record<string, unknown>[],
  alerts: Record<string, unknown>[],
  metrics: Record<string, unknown>[],
  previousSummary: string
): string {
  const lines: string[] = [];

  lines.push(`=== BRIEFING EJECUTIVO ${today} ===\n`);
  lines.push(`Cuentas analizadas: ${summaries.length}`);

  if (previousSummary) {
    lines.push(`\n--- CONTEXTO PREVIO ---`);
    lines.push(previousSummary.slice(0, 1000));
  }

  lines.push(`\n--- RESÚMENES POR CUENTA ---`);
  for (const s of summaries) {
    const json = s.summary_json as Record<string, unknown>;
    lines.push(`\nCuenta: ${s.account} (${json?.department ?? "?"})`);
    lines.push(`Emails: ${json?.total_emails ?? 0}`);
    lines.push(`Sentimiento: ${json?.overall_sentiment ?? "?"} (${json?.sentiment_score ?? 0})`);
    if (json?.summary_text) lines.push(`Resumen: ${json.summary_text}`);
    if (json?.risks_detected) {
      const risks = json.risks_detected as { risk: string; severity: string }[];
      for (const r of risks) lines.push(`  ⚠️ ${r.severity}: ${r.risk}`);
    }
  }

  if (alerts.length) {
    lines.push(`\n--- ALERTAS ACTIVAS (${alerts.length}) ---`);
    for (const a of alerts.slice(0, 15)) {
      lines.push(`[${a.severity}] ${a.title}: ${(a.description as string ?? "").slice(0, 200)}`);
    }
  }

  if (metrics.length) {
    lines.push(`\n--- MÉTRICAS DE RESPUESTA ---`);
    for (const m of metrics) {
      lines.push(`${m.account}: recibidos=${m.emails_received}, enviados=${m.emails_sent}, sin responder=${m.threads_unanswered}`);
    }
  }

  return lines.join("\n");
}
