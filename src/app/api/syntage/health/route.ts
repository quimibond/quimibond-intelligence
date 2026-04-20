import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Syntage sync health report.
 *
 * Returns a snapshot JSON with:
 *   - row counts per syntage_* table
 *   - extractions status with syntage_total vs our_count
 *   - cross-check with Odoo (invoices match / gaps)
 *   - error rate last hour
 *   - last webhook timestamp
 *
 * Auth: pipeline-level (CRON_SECRET bearer, Vercel cron header, or qb-auth cookie).
 */
export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  const [
    counts,
    extractions,
    odooCheck,
    errorRate,
    yearly,
  ] = await Promise.all([
    getRowCounts(supabase),
    getExtractionsStatus(supabase),
    getOdooCrossCheck(supabase),
    getErrorRate(supabase),
    getYearlyDistribution(supabase),
  ]);

  const healthSignal: "healthy" | "warn" | "critical" = computeHealth(errorRate, counts, extractions);

  return NextResponse.json({
    health: healthSignal,
    generatedAt: new Date().toISOString(),
    counts,
    extractions,
    odoo_cross_check: odooCheck,
    error_rate: errorRate,
    yearly_distribution: yearly,
  });
}

async function getRowCounts(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): Promise<Record<string, number>> {
  const tables = [
    "syntage_webhook_events",
    "syntage_taxpayers",
    "syntage_extractions",
    "syntage_invoices",
    "syntage_invoice_line_items",
    "syntage_invoice_payments",
    "syntage_tax_retentions",
    "syntage_tax_returns",
    "syntage_tax_status",
    "syntage_electronic_accounting",
    "syntage_files",
  ];
  const out: Record<string, number> = {};
  await Promise.all(tables.map(async t => {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    out[t] = count ?? 0;
  }));
  return out;
}

async function getExtractionsStatus(
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  const { data } = await supabase
    .from("syntage_extractions")
    .select("syntage_id, extractor_type, status, started_at, finished_at, rows_produced, raw_payload")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map(r => ({
    id: (r.syntage_id as string).slice(0, 8),
    extractor: r.extractor_type,
    status: r.status,
    started_at: r.started_at,
    finished_at: r.finished_at,
    our_count: r.rows_produced,
    syntage_total: (r.raw_payload as { totalDataPoints?: number } | null)?.totalDataPoints ?? 0,
    syntage_created: (r.raw_payload as { createdDataPoints?: number } | null)?.createdDataPoints ?? 0,
    syntage_updated: (r.raw_payload as { updatedDataPoints?: number } | null)?.updatedDataPoints ?? 0,
    error_code: (r.raw_payload as { errorCode?: string | null } | null)?.errorCode ?? null,
  }));
}

async function getOdooCrossCheck(
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  const { data } = await supabase.rpc("exec_sql_readonly", {
    query: `
      SELECT
        (SELECT count(*) FROM public.syntage_invoices) as syntage_invoices,
        (SELECT count(*) FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL) as odoo_with_uuid,
        (SELECT count(*) FROM public.syntage_invoices s JOIN public.odoo_invoices o ON lower(s.uuid) = lower(o.cfdi_uuid)) as matched_uuid,
        (SELECT count(*) FROM public.syntage_invoices s WHERE NOT EXISTS (SELECT 1 FROM public.odoo_invoices o WHERE lower(o.cfdi_uuid) = lower(s.uuid))) as syntage_only,
        (SELECT count(*) FROM public.odoo_invoices o WHERE o.cfdi_uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.syntage_invoices s WHERE lower(s.uuid) = lower(o.cfdi_uuid))) as odoo_only;
    `,
  }).single();

  if (!data) {
    // Fallback: compute via separate queries if the RPC doesn't exist.
    return computeOdooCrossCheckFallback(supabase);
  }
  const d = data as Record<string, number>;
  return {
    syntage_invoices: d.syntage_invoices ?? 0,
    odoo_with_uuid: d.odoo_with_uuid ?? 0,
    matched_uuid: d.matched_uuid ?? 0,
    syntage_only: d.syntage_only ?? 0,
    odoo_only: d.odoo_only ?? 0,
    pct_syntage_covered_by_odoo: d.syntage_invoices
      ? Math.round((1000 * d.matched_uuid) / d.syntage_invoices) / 10
      : 0,
    pct_odoo_covered_by_syntage: d.odoo_with_uuid
      ? Math.round((1000 * d.matched_uuid) / d.odoo_with_uuid) / 10
      : 0,
  };
}

async function computeOdooCrossCheckFallback(
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  // legitimate raw use: cross-check syntage_invoices ↔ odoo_invoices via cfdi_uuid — this IS the reconciliation layer
  const [{ count: syntageCount }, { count: odooCount }, { data: syntageUuids }] = await Promise.all([
    supabase.from("syntage_invoices").select("*", { count: "exact", head: true }),
    supabase.from("odoo_invoices").select("*", { count: "exact", head: true }).not("cfdi_uuid", "is", null),
    supabase.from("syntage_invoices").select("uuid").limit(10000),
  ]);

  const uuids = (syntageUuids ?? []).map(r => (r.uuid as string).toLowerCase());
  let matched = 0;
  if (uuids.length > 0) {
    // legitimate raw use: UUID matching against odoo_invoices.cfdi_uuid — raw needed for cross-source reconciliation
    const { count } = await supabase
      .from("odoo_invoices")
      .select("*", { count: "exact", head: true })
      .in("cfdi_uuid", uuids);
    matched = count ?? 0;
  }

  const sc = syntageCount ?? 0;
  const oc = odooCount ?? 0;
  return {
    syntage_invoices: sc,
    odoo_with_uuid: oc,
    matched_uuid: matched,
    syntage_only: sc - matched,
    odoo_only: oc - matched,
    pct_syntage_covered_by_odoo: sc ? Math.round((1000 * matched) / sc) / 10 : 0,
    pct_odoo_covered_by_syntage: oc ? Math.round((1000 * matched) / oc) / 10 : 0,
  };
}

async function getErrorRate(
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();

  const [{ count: webhookCount }, { count: errorCount }, { data: errorSamples }] = await Promise.all([
    supabase
      .from("syntage_webhook_events")
      .select("*", { count: "exact", head: true })
      .gte("received_at", since),
    supabase
      .from("pipeline_logs")
      .select("*", { count: "exact", head: true })
      .eq("phase", "syntage_webhook")
      .eq("level", "error")
      .gte("created_at", since),
    supabase
      .from("pipeline_logs")
      .select("details, created_at")
      .eq("phase", "syntage_webhook")
      .eq("level", "error")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const wc = webhookCount ?? 0;
  const ec = errorCount ?? 0;
  return {
    webhooks_last_1h: wc,
    errors_last_1h: ec,
    error_rate_pct: wc ? Math.round((1000 * ec) / wc) / 10 : 0,
    sample_errors: (errorSamples ?? []).map(r => ({
      at: r.created_at,
      event_type: (r.details as { event_type?: string } | null)?.event_type,
      error: (r.details as { error?: { message?: string } } | null)?.error?.message,
    })),
  };
}

async function getYearlyDistribution(
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  // Lightweight: fetch up to 10k rows, compute distribution in memory.
  const { data } = await supabase
    .from("syntage_invoices")
    .select("fecha_emision, direction")
    .not("fecha_emision", "is", null)
    .limit(10000);

  const byYear: Record<string, { issued: number; received: number; total: number }> = {};
  for (const row of data ?? []) {
    const y = new Date(row.fecha_emision as string).getUTCFullYear();
    const key = String(y);
    if (!byYear[key]) byYear[key] = { issued: 0, received: 0, total: 0 };
    byYear[key].total++;
    if (row.direction === "issued") byYear[key].issued++;
    else byYear[key].received++;
  }
  return Object.entries(byYear)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, stats]) => ({ year: Number(year), ...stats }));
}

function computeHealth(
  errorRate: { error_rate_pct: number; webhooks_last_1h: number },
  counts: Record<string, number>,
  extractions: Array<{ status: string; error_code?: string | null }>,
): "healthy" | "warn" | "critical" {
  const failed = extractions.filter(e => e.status === "failed" || e.error_code).length;
  if (failed > 0) return "critical";
  if (errorRate.error_rate_pct > 5) return "critical";
  if (errorRate.error_rate_pct > 1) return "warn";
  if (counts.syntage_webhook_events === 0) return "warn";
  return "healthy";
}
