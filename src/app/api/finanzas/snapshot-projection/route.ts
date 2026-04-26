/**
 * F-SNAPSHOTS — Cron diario para capturar predicción del cash projection.
 *
 * Se ejecuta cada día a las 06:00 (Vercel cron). Captura el cash
 * projection actual (horizonte 90d) y lo persiste en projection_snapshots
 * agregado por semana. Idempotente — si corre 2× el mismo día, hace
 * UPSERT por (snapshot_date, horizon_days, week_start).
 *
 * El loop completo:
 *   1. captura aquí
 *   2. comparación con realidad cuando la semana objetivo ya pasó
 *      (vía getProjectionAccuracy desde el dashboard /finanzas)
 *   3. MAPE feedback al CEO de qué tan confiable es el modelo
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getCashProjection } from "@/lib/queries/sp13/finanzas/projection";
import { captureProjectionSnapshot } from "@/lib/queries/sp13/finanzas/projection-snapshots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    // Capturamos en horizonte 90 días para tener cobertura amplia (13 semanas)
    const projection = await getCashProjection(90);
    const result = await captureProjectionSnapshot(projection);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
