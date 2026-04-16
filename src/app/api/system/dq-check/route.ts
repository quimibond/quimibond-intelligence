import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 30;

/**
 * DQ Integrity Check — corre `dq_cron_integrity_check()` en Supabase
 * y loguea cada invariante que falle a `pipeline_logs`.
 *
 * Diseñado para prevenir rompimientos silenciosos tipo M3 CASCADE:
 *   - Si una view crítica se cae, el cron lo detecta al vuelo
 *   - pipeline_logs con level=error para CRITICAL, warn para HIGH
 *   - Visible en /system → Logs inmediatamente
 *
 * Schedule: cada 6h (configurado en vercel.json). Se puede bajar a 1h
 * si se necesita más reactividad.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const sb = getServiceClient();
  const { data, error } = await sb.rpc("dq_cron_integrity_check");

  if (error) {
    console.error("[dq-check]", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const summary = data as {
    total_issues: number;
    critical: number;
    high: number;
    timestamp: string;
  } | null;

  return NextResponse.json({
    ok: true,
    summary,
  });
}
