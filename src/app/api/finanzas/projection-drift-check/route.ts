/**
 * Audit 2026-04-27 finding #18 — Drift detection cron.
 *
 * Compara la precisión de las proyecciones (MAPE rolling 8 semanas) contra
 * umbrales y crea un insight CEO-facing cuando se cruza high/critical.
 *
 * Severity → insight severity:
 *   high     → "high"     (modelo degradándose, recalibrar pronto)
 *   critical → "critical" (modelo no confiable, intervenir ya)
 *
 * Idempotente por día: si ya existe insight de drift para hoy con la
 * misma severity, no duplica.
 *
 * Schedule: diario 06:30 (después del snapshot capture a las 06:00).
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { getProjectionDriftStatus } from "@/lib/queries/sp13/finanzas/projection-snapshots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const drift = await getProjectionDriftStatus(8);
    const sb = getServiceClient();

    // Solo creamos insight si la severidad cruza umbral accionable
    if (drift.overallSeverity !== "high" && drift.overallSeverity !== "critical") {
      return NextResponse.json({
        ok: true,
        drift,
        insightCreated: false,
        reason: `severity=${drift.overallSeverity} (no insight needed)`,
      });
    }

    // Idempotencia: si ya hay insight de drift para hoy con misma severity, skip
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: existing } = await sb
      .from("agent_insights")
      .select("id")
      .ilike("title", "Drift cash projection%")
      .eq("severity", drift.overallSeverity)
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        ok: true,
        drift,
        insightCreated: false,
        reason: "duplicate (same severity already created today)",
      });
    }

    // Resolver agente "finance" para asignar el insight (mismo agente que
    // produce alerts de cobranza/riesgo financiero).
    const { data: financeAgent } = await sb
      .from("ai_agents")
      .select("id")
      .eq("slug", "finance")
      .limit(1)
      .maybeSingle();

    if (!financeAgent?.id) {
      return NextResponse.json({
        ok: false,
        error: "finance agent not found — cannot route insight",
        drift,
      }, { status: 500 });
    }

    const directional =
      drift.biasInflow < -15 || drift.biasOutflow < -15
        ? "El modelo es OPTIMISTA (predice más cash del real)"
        : drift.biasInflow > 15 || drift.biasOutflow > 15
          ? "El modelo es PESIMISTA (predice menos cash del real)"
          : "Sin sesgo direccional claro — solo ruido";

    const evidence = [
      `Ventana: últimas ${drift.weeksCompared} semanas con outcome conocido`,
      `MAPE inflow: ${drift.mapeInflow}% (severity=${drift.inflowSeverity})`,
      `MAPE outflow: ${drift.mapeOutflow}% (severity=${drift.outflowSeverity})`,
      `Bias inflow: ${drift.biasInflow}% (severity=${drift.biasInflowSeverity})`,
      `Bias outflow: ${drift.biasOutflow}% (severity=${drift.biasOutflowSeverity})`,
      directional,
    ];

    const description =
      drift.overallSeverity === "critical"
        ? `El modelo de cash projection está fallando con error >40%. ` +
          `Las predicciones no son confiables hasta recalibrar. ` +
          `Causa probable: cambio reciente en patrón AR/AP, sync banco roto, ` +
          `o un cliente/proveedor grande con comportamiento atípico.`
        : `El modelo de cash projection se está degradando (error >25%). ` +
          `Aún utilizable pero requiere atención. ` +
          `Revisar: clientes top con cambios en pago, cron snapshot funcionando, ` +
          `o ajustes de heurísticas en aging/delays.`;

    const { error: insertErr } = await sb.from("agent_insights").insert({
      agent_id: financeAgent.id,
      insight_type: "anomaly",
      category: "datos",
      severity: drift.overallSeverity,
      title: `Drift cash projection: MAPE ${Math.max(drift.mapeInflow, drift.mapeOutflow)}%`,
      description,
      evidence,
      recommendation:
        `1. Revisar /finanzas — chart vs realidad última semana. ` +
        `2. Validar canonical_bank_balances.is_stale (sync banco). ` +
        `3. Si MAPE persiste >2 semanas, revisar params learnedAging y ` +
        `delays AP/AR. 4. Considerar bumpear cache key para forzar refresh.`,
      confidence: 1.0,
      business_impact_estimate: null,
      state: "new",
    });

    if (insertErr) {
      return NextResponse.json({
        ok: false,
        error: insertErr.message,
        drift,
      }, { status: 500 });
    }

    await sb.from("pipeline_logs").insert({
      level: drift.overallSeverity === "critical" ? "error" : "warning",
      phase: "projection_drift_check",
      message: `Drift detected: ${drift.overallSeverity} (MAPE inflow=${drift.mapeInflow}%, outflow=${drift.mapeOutflow}%)`,
      details: { drift },
    });

    return NextResponse.json({
      ok: true,
      drift,
      insightCreated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
