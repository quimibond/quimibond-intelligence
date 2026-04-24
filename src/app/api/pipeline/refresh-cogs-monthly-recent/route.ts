/**
 * Refresh rápido del cache cogs_monthly_cache para los últimos 3 meses.
 *
 * El cron nightly (/api/pipeline/refresh-cogs-monthly, 03:30 UTC)
 * refresca los 28+ meses completos en ~25s. Durante el día, nuevos
 * asientos pueden entrar vía Odoo sync (cada hora) afectando el mes
 * actual o el anterior. Este endpoint refresca sólo los últimos 3 meses
 * (~3s total) cada hora para mantener el cache fresco.
 *
 * Cron: cada hora en vercel.json → finanzas-cogs-recent.
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

  const sb = getServiceClient();
  const start = Date.now();

  // Calcular "hace 2 meses" en YYYY-MM
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() - 2; // hace 2 meses (incluye actual + anterior + dos anteriores)
  const adjustedY = m < 0 ? y - 1 : y;
  const adjustedM = ((m % 12) + 12) % 12;
  const fromMonth = `${adjustedY}-${String(adjustedM + 1).padStart(2, "0")}`;

  try {
    const { data, error } = await sb.rpc("refresh_cogs_monthly_cache", {
      p_from_month: fromMonth,
    });
    if (error) {
      console.error("[refresh-cogs-recent]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const elapsedMs = Date.now() - start;
    const rowsUpdated = Number(data) || 0;

    await sb.from("pipeline_logs").insert({
      level: "info",
      phase: "refresh_cogs_monthly_recent",
      message: `Refreshed ${rowsUpdated} months (from ${fromMonth}) in ${elapsedMs}ms`,
      metadata: { rows: rowsUpdated, from_month: fromMonth, elapsed_ms: elapsedMs },
    });

    return NextResponse.json({
      success: true,
      rows: rowsUpdated,
      from_month: fromMonth,
      elapsed_ms: elapsedMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[refresh-cogs-recent] exception", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
