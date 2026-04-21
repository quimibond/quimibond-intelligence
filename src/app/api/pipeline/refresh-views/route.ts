/**
 * Refresh materialized views — keeps analytics fresh for dashboard.
 *
 * Llama a refresh_all_analytics_robust() que auto-descubre todas las MVs
 * en pg_matviews (actualmente 34 totales en public schema; SP1 dropo 5 que
 * tenian 0 callers: products_unified, product_price_history,
 * cross_director_signals, product_seasonality, syntage_invoices_enriched).
 *
 * refresh_all_analytics_robust() aisla cada REFRESH en su propio try/catch
 * y loggea per-matview a pipeline_logs con phase='refresh_matview'.
 * A diferencia del legacy refresh_all_matviews(), no cascadea errores.
 *
 * Cron: cada 6h. Si una matview individual falla, el resto sigue.
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
    const { data, error } = await supabase.rpc("refresh_all_analytics_robust", { p_concurrent: true });
    if (error) {
      console.error("[refresh-views]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const elapsedMs = Date.now() - start;
    const result = (data ?? {}) as {
      successes?: number;
      errors?: number;
      total_duration_ms?: number;
      matviews?: Array<{ matview: string; status: string; elapsed_s: number; error: string | null }>;
    };

    // Log resumen a pipeline_logs (el per-matview ya lo hace la funcion SQL)
    await supabase.from("pipeline_logs").insert({
      level: result.errors && result.errors > 0 ? "warning" : "info",
      phase: "refresh_analytics",
      message: `Refreshed ${result.successes ?? 0}/${(result.successes ?? 0) + (result.errors ?? 0)} matviews in ${Math.round(elapsedMs / 1000)}s`,
      details: {
        successes: result.successes,
        errors: result.errors,
        duration_ms: result.total_duration_ms ?? elapsedMs,
      },
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
