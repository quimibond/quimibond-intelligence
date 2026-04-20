import { getServiceClient } from "@/lib/supabase-server";

export type SyntageHealthSignal = "healthy" | "warn" | "critical";

export interface SyntageHealthReport {
  health: SyntageHealthSignal;
  generated_at: string;
  counts: Record<string, number>;
  extractions: Array<{
    id: string;
    extractor: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    our_count: number;
    syntage_total: number;
    syntage_created: number;
    syntage_updated: number;
    error_code: string | null;
  }>;
  odoo_cross_check: {
    syntage_invoices: number;
    odoo_with_uuid: number;
    matched_uuid: number;
    syntage_only: number;
    odoo_only: number;
    pct_syntage_covered_by_odoo: number;
    pct_odoo_covered_by_syntage: number;
  };
  error_rate: {
    webhooks_last_1h: number;
    errors_last_1h: number;
    error_rate_pct: number;
    sample_errors: Array<{
      at: string;
      event_type: string | undefined;
      error: string | undefined;
    }>;
  };
  yearly_distribution: Array<{
    year: number;
    issued: number;
    received: number;
    total: number;
  }>;
}

export async function getSyntageHealth(): Promise<SyntageHealthReport> {
  const supabase = getServiceClient();

  const [counts, extractions, odoo, errors, yearly] = await Promise.all([
    getRowCounts(supabase),
    getExtractions(supabase),
    getOdooCrossCheck(supabase),
    getErrorRate(supabase),
    getYearlyDistribution(supabase),
  ]);

  const failed = extractions.filter(e => e.status === "failed" || e.error_code).length;
  let health: SyntageHealthSignal = "healthy";
  if (failed > 0) health = "critical";
  else if (errors.error_rate_pct > 5) health = "critical";
  else if (errors.error_rate_pct > 1) health = "warn";
  else if (counts.syntage_webhook_events === 0) health = "warn";

  return {
    health,
    generated_at: new Date().toISOString(),
    counts,
    extractions,
    odoo_cross_check: odoo,
    error_rate: errors,
    yearly_distribution: yearly,
  };
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

async function getExtractions(supabase: import("@supabase/supabase-js").SupabaseClient) {
  const { data } = await supabase
    .from("syntage_extractions")
    .select("syntage_id, extractor_type, status, started_at, finished_at, rows_produced, raw_payload")
    .order("created_at", { ascending: false })
    .limit(20); // intentional: recent 20 extractions for status display
  return (data ?? []).map(r => ({
    id: (r.syntage_id as string).slice(0, 8),
    extractor: r.extractor_type as string,
    status: r.status as string,
    started_at: r.started_at as string | null,
    finished_at: r.finished_at as string | null,
    our_count: (r.rows_produced as number) ?? 0,
    syntage_total: (r.raw_payload as { totalDataPoints?: number } | null)?.totalDataPoints ?? 0,
    syntage_created: (r.raw_payload as { createdDataPoints?: number } | null)?.createdDataPoints ?? 0,
    syntage_updated: (r.raw_payload as { updatedDataPoints?: number } | null)?.updatedDataPoints ?? 0,
    error_code: (r.raw_payload as { errorCode?: string | null } | null)?.errorCode ?? null,
  }));
}

async function getOdooCrossCheck(supabase: import("@supabase/supabase-js").SupabaseClient) {
  // legitimate raw use: cross-check syntage_invoices ↔ odoo_invoices via cfdi_uuid — this IS the reconciliation layer
  const [{ count: syntageCount }, { count: odooCount }] = await Promise.all([
    supabase.from("syntage_invoices").select("*", { count: "exact", head: true }),
    supabase.from("odoo_invoices").select("*", { count: "exact", head: true }).not("cfdi_uuid", "is", null),
  ]);

  // Batch match: fetch all syntage UUIDs and count how many exist in odoo.
  const { data: syntageUuids } = await supabase
    .from("syntage_invoices")
    .select("uuid")
    .limit(20000); // intentional: enumerate all UUIDs for cross-source reconciliation count

  const uuids = (syntageUuids ?? []).map(r => (r.uuid as string).toLowerCase()).filter(Boolean);

  let matched = 0;
  // legitimate raw use: UUID matching against odoo_invoices.cfdi_uuid — raw needed for cross-source reconciliation
  const chunkSize = 500;
  for (let i = 0; i < uuids.length; i += chunkSize) {
    const chunk = uuids.slice(i, i + chunkSize);
    const { count } = await supabase
      .from("odoo_invoices")
      .select("*", { count: "exact", head: true })
      .in("cfdi_uuid", chunk);
    matched += count ?? 0;
  }

  const sc = syntageCount ?? 0;
  const oc = odooCount ?? 0;
  return {
    syntage_invoices: sc,
    odoo_with_uuid: oc,
    matched_uuid: matched,
    syntage_only: Math.max(0, sc - matched),
    odoo_only: Math.max(0, oc - matched),
    pct_syntage_covered_by_odoo: sc ? Math.round((1000 * matched) / sc) / 10 : 0,
    pct_odoo_covered_by_syntage: oc ? Math.round((1000 * matched) / oc) / 10 : 0,
  };
}

async function getErrorRate(supabase: import("@supabase/supabase-js").SupabaseClient) {
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
      .limit(5), // intentional: top 5 sample errors for sidebar card
  ]);
  const wc = webhookCount ?? 0;
  const ec = errorCount ?? 0;
  return {
    webhooks_last_1h: wc,
    errors_last_1h: ec,
    error_rate_pct: wc ? Math.round((1000 * ec) / wc) / 10 : 0,
    sample_errors: (errorSamples ?? []).map(r => ({
      at: r.created_at as string,
      event_type: (r.details as { event_type?: string } | null)?.event_type,
      error: (r.details as { error?: { message?: string } } | null)?.error?.message,
    })),
  };
}

async function getYearlyDistribution(supabase: import("@supabase/supabase-js").SupabaseClient) {
  const { data } = await supabase
    .from("syntage_invoices")
    .select("fecha_emision, direction")
    .not("fecha_emision", "is", null)
    .limit(20000); // intentional: enumerate all for yearly distribution histogram

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
