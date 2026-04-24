/**
 * Refresh cogs_monthly_cache — precomputed monthly COGS comparison.
 *
 * El RPC `get_cogs_comparison_monthly` lee de `cogs_monthly_cache` (tabla
 * ya materializada). Esta función refresca toda la tabla desde
 * 2024-01 hasta el mes actual inclusive. ~25s para 28 meses.
 *
 * Cron: nightly (3:30 AM UTC) en vercel.json → finanzas-cogs-refresh.
 *
 * La función Silver `refresh_cogs_monthly_cache()` llama internamente a
 * `_compute_cogs_comparison_monthly` (la versión pesada) y upsertea los
 * resultados en `cogs_monthly_cache`. Evita la recursión con
 * `get_cogs_comparison_monthly` (que ahora lee del cache).
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

  const sb = getServiceClient();
  const start = Date.now();

  try {
    const { data, error } = await sb.rpc("refresh_cogs_monthly_cache", {
      p_from_month: "2024-01",
    });
    if (error) {
      console.error("[refresh-cogs-monthly]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const elapsedMs = Date.now() - start;
    const rowsUpdated = Number(data) || 0;

    await sb.from("pipeline_logs").insert({
      level: "info",
      phase: "refresh_cogs_monthly",
      message: `Refreshed ${rowsUpdated} months in ${elapsedMs}ms`,
      metadata: { rows: rowsUpdated, elapsed_ms: elapsedMs },
    });

    return NextResponse.json({
      success: true,
      rows: rowsUpdated,
      elapsed_ms: elapsedMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[refresh-cogs-monthly] exception", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
