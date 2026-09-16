/**
 * syntage-daily (Edge Function) — pide a Syntage una extracción incremental
 * de CFDIs (ventana de los últimos 4 días, con solape para timbrados tardíos).
 * Reemplaza a /api/syntage/cron-daily de Vercel. Los datos llegan después por
 * el webhook (syntage-webhook). Cada extracción tiene costo en Syntage: no
 * ampliar la ventana sin motivo.
 *
 * Disparo: pg_cron `memoria_syntage_daily` 05:00 UTC → invoke_edge('syntage-daily').
 * Body opcional: { "taxpayer": "PNT920218IW5", "days": 4, "include_retentions": false }
 */
import { serviceClient, authorizeCron, json, loadSecret, pipelineLog, readBody } from "../_shared/env.ts";

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

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const apiKey = await loadSecret(supabase, "SYNTAGE_API_KEY", "syntage_api_key");
  if (!apiKey) {
    await pipelineLog(supabase, "syntage_cron_daily", "error", "Syntage: syntage_api_key no configurado (env ni Vault)");
    return json({ error: "syntage_api_key no configurado" }, 503);
  }
  const apiBase = Deno.env.get("SYNTAGE_API_BASE") ?? "https://api.syntage.com";

  const body = await readBody(req);
  const taxpayer = typeof body.taxpayer === "string" && body.taxpayer ? body.taxpayer : "PNT920218IW5";
  const lookbackDays = Math.max(1, Math.min(30, Number(body.days) || 4));
  const includeRetentions = body.include_retentions === true;

  const today = new Date();
  const fromIso = new Date(today.getTime() - lookbackDays * 86400000).toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);
  const extractors = includeRetentions ? ["invoice", "tax_retention"] : ["invoice"];
  const results: CronResult[] = [];

  for (const extractor of extractors) {
    const options = extractor === "invoice"
      ? { period: { from: fromIso, to: toIso }, issued: true, received: true, xml: true, pdf: true, types: ["I", "E", "P", "N", "T"], complement: -1 }
      : { period: { from: fromIso, to: toIso }, issued: true, received: true, xml: true, pdf: true, complement: -1 };
    try {
      const res = await fetch(`${apiBase}/extractions`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/ld+json" },
        body: JSON.stringify({ taxpayer: `/taxpayers/${taxpayer}`, extractor, options }),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      results.push({ ok: res.ok, taxpayer, extractor, from: fromIso, to: toIso, extraction: res.ok ? parsed : undefined, error: res.ok ? undefined : String(parsed).slice(0, 500), status: res.status });
    } catch (e) {
      results.push({ ok: false, taxpayer, extractor, from: fromIso, to: toIso, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  await pipelineLog(
    supabase,
    "syntage_cron_daily",
    allOk ? "info" : "warning",
    `Daily Syntage cron: ${results.length} extraction(s) requested (taxpayer=${taxpayer}, window=${fromIso}..${toIso}). ${results.filter((r) => r.ok).length}/${results.length} ok.`,
    { results, lookbackDays },
  );
  return json({ ok: allOk, window: { from: fromIso, to: toIso, lookbackDays }, taxpayer, results }, allOk ? 200 : 502);
});
