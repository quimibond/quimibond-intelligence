import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Cron diario que dispara una extracción Syntage incremental para mantener
 * `syntage_invoices` y `syntage_invoice_payments` frescos. Antes de este
 * endpoint, las extracciones eran 100% manuales (audit 2026-04-27 detectó
 * 7 días sin extracciones desde 2026-04-20 → AR/AP staleness en /cobranza
 * y /finanzas).
 *
 * Estrategia: ventana de últimos 4 días (3 días de overlap con el run
 * anterior + el día de hoy) — esto absorbe re-timbrados tardíos del SAT
 * sin disparar el extractor sobre meses completos.
 *
 * Disparado por Vercel Cron @ 06:00 UTC daily.
 *
 * IMPORTANTE: cada extracción tiene COSTO en Syntage. La ventana de 4 días
 * es la mínima que captura late stamps típicos. Si se necesita backfill
 * histórico, usar /api/syntage/backfill con `from`/`to` explícitos.
 */
export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}

interface CronResult {
  ok: boolean;
  taxpayer: string;
  extractor: string;
  from: string;
  to: string;
  extraction?: unknown;
  error?: string;
  status?: number;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.SYNTAGE_API_KEY;
  const apiBase = process.env.SYNTAGE_API_BASE ?? "https://api.syntage.com";
  if (!apiKey) {
    return NextResponse.json(
      { error: "SYNTAGE_API_KEY not set" },
      { status: 503 }
    );
  }

  // Default Quimibond RFC; overridable via query for safety/testing
  const url = new URL(request.url);
  const taxpayer = url.searchParams.get("taxpayer") ?? "PNT920218IW5";
  const lookbackDaysRaw = url.searchParams.get("days");
  const lookbackDays = Math.max(
    1,
    Math.min(30, Number(lookbackDaysRaw) || 4)
  );

  const today = new Date();
  const fromDate = new Date(today.getTime() - lookbackDays * 86400000);
  const fromIso = fromDate.toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);

  const results: CronResult[] = [];

  // Solo `invoice` por default — es el que mueve la aguja en AR/AP.
  // tax_retention podría agregarse con `?include_retentions=1`.
  const includeRetentions = url.searchParams.get("include_retentions") === "1";
  const extractors = includeRetentions
    ? ["invoice", "tax_retention"]
    : ["invoice"];

  for (const extractor of extractors) {
    const options =
      extractor === "invoice"
        ? {
            period: { from: fromIso, to: toIso },
            issued: true,
            received: true,
            xml: true,
            pdf: true,
            types: ["I", "E", "P", "N", "T"],
            complement: -1,
          }
        : {
            period: { from: fromIso, to: toIso },
            issued: true,
            received: true,
            xml: true,
            pdf: true,
            complement: -1,
          };

    const syntageBody = {
      taxpayer: `/taxpayers/${taxpayer}`,
      extractor,
      options,
    };

    try {
      const syntageRes = await fetch(`${apiBase}/extractions`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/ld+json",
        },
        body: JSON.stringify(syntageBody),
      });
      const text = await syntageRes.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      results.push({
        ok: syntageRes.ok,
        taxpayer,
        extractor,
        from: fromIso,
        to: toIso,
        extraction: syntageRes.ok ? parsed : undefined,
        error: syntageRes.ok ? undefined : String(parsed),
        status: syntageRes.status,
      });
    } catch (e) {
      results.push({
        ok: false,
        taxpayer,
        extractor,
        from: fromIso,
        to: toIso,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Best-effort log a pipeline_logs (no bloquea respuesta si falla).
  try {
    const sb = getServiceClient();
    await sb.from("pipeline_logs").insert([
      {
        level: results.every((r) => r.ok) ? "info" : "warning",
        phase: "syntage_cron_daily",
        message:
          `Daily Syntage cron: ${results.length} extraction(s) requested ` +
          `(taxpayer=${taxpayer}, window=${fromIso}..${toIso}). ` +
          `${results.filter((r) => r.ok).length}/${results.length} ok.`,
        details: { results, lookbackDays },
      },
    ]);
  } catch (logErr) {
    console.error("[syntage/cron-daily] failed to log:", logErr);
  }

  const status = results.every((r) => r.ok) ? 200 : 502;
  return NextResponse.json(
    {
      ok: results.every((r) => r.ok),
      window: { from: fromIso, to: toIso, lookbackDays },
      taxpayer,
      results,
      hint: "Track progress in public.syntage_extractions; data lands in syntage_invoices via webhook.",
    },
    { status }
  );
}
