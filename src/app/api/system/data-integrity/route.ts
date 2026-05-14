/**
 * Data Integrity Audit — single-shot health check across the data stack.
 *
 * Runs N independent probes and returns a JSON status with criticals + warnings.
 * Designed for:
 *   - CEO sanity check ("¿están los datos al día?")
 *   - Vercel cron alarm (e.g. every 30 min, post to Slack if criticals > 0)
 *   - Local CLI (`pnpm tsx scripts/validate-data-integrity.mjs`)
 *
 * Probes (each is independent; one failure does not stop the others):
 *  1. bronze_freshness     — odoo_sync_freshness.status per table
 *  2. syntage_freshness    — syntage_invoices/payments max(synced_at)
 *  3. gmail_freshness      — emails.created_at max
 *  4. silver_mv_health     — last successful refresh per canonical_* / mv_* MV
 *  5. silver_duplicates    — canonical_companies dup by odoo_partner_id
 *  6. silver_recon_health  — pg_cron.job_run_details for silver_sp* jobs
 *  7. gold_periods         — most recent period in gold_pl_statement / gold_balance_sheet
 *  8. pipeline_logs_errors — error/warning counts last 24h grouped by phase
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Severity = "ok" | "warning" | "critical";

interface ProbeResult {
  probe: string;
  severity: Severity;
  message: string;
  details?: unknown;
}

interface AuditResponse {
  generated_at: string;
  duration_ms: number;
  overall: Severity;
  criticals: number;
  warnings: number;
  probes: ProbeResult[];
}

const FRESH_HOURS_HARD_LIMIT = 6;   // odoo bronze hardly more than this
const SYNTAGE_HARD_LIMIT = 72;      // CFDIs may be slower
const GMAIL_HARD_LIMIT = 2;
const GOLD_PERIOD_LAG_DAYS = 35;

export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();
  const started = Date.now();
  const probes: ProbeResult[] = [];

  // 1. Bronze freshness via odoo_sync_freshness sentinel view
  try {
    const { data, error } = await supabase
      .from("odoo_sync_freshness")
      .select("table_name, hours_ago, expected_hours, status")
      .order("hours_ago", { ascending: false });
    if (error) throw error;
    type FreshnessRow = { table_name: string; hours_ago: number; expected_hours: number; status: string };
    const rows = (data ?? []) as FreshnessRow[];
    const stale = rows.filter((r) => r.status === "stale");
    const warn = rows.filter((r) => r.status === "warning");
    probes.push({
      probe: "bronze_freshness",
      severity: stale.length > 5 ? "critical" : stale.length > 0 ? "warning" : "ok",
      message:
        stale.length === 0
          ? `Todas las ${rows.length} tablas Bronze frescas`
          : `${stale.length} stale · ${warn.length} warning · oldest: ${stale[0]?.table_name} (${stale[0]?.hours_ago}h)`,
      details: { stale: stale.slice(0, 10), warnings: warn.slice(0, 10) },
    });
  } catch (e) {
    probes.push({ probe: "bronze_freshness", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 2. Syntage freshness
  try {
    const { data: inv } = await supabase
      .from("syntage_invoices")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1);
    const { data: pay } = await supabase
      .from("syntage_invoice_payments")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1);
    const invHours = inv?.[0] ? hoursAgo(inv[0].synced_at) : null;
    const payHours = pay?.[0] ? hoursAgo(pay[0].synced_at) : null;
    const sev: Severity =
      (invHours ?? 999) > SYNTAGE_HARD_LIMIT * 2 || (payHours ?? 999) > SYNTAGE_HARD_LIMIT * 2
        ? "critical"
        : (invHours ?? 0) > SYNTAGE_HARD_LIMIT || (payHours ?? 0) > SYNTAGE_HARD_LIMIT
        ? "warning"
        : "ok";
    probes.push({
      probe: "syntage_freshness",
      severity: sev,
      message: `CFDIs ${formatH(invHours)}, complementos pago ${formatH(payHours)}`,
      details: { invoices_hours: invHours, payments_hours: payHours },
    });
  } catch (e) {
    probes.push({ probe: "syntage_freshness", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 3. Gmail freshness
  try {
    const { data } = await supabase
      .from("emails")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    const h = data?.[0] ? hoursAgo(data[0].created_at) : null;
    probes.push({
      probe: "gmail_freshness",
      severity: (h ?? 0) > GMAIL_HARD_LIMIT * 2 ? "critical" : (h ?? 0) > GMAIL_HARD_LIMIT ? "warning" : "ok",
      message: `Último email ${formatH(h)}`,
      details: { hours_ago: h },
    });
  } catch (e) {
    probes.push({ probe: "gmail_freshness", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 4. Silver MV health (last 14d of pipeline_logs.refresh_matview)
  try {
    const { data: logs } = await supabase
      .from("pipeline_logs")
      .select("level, message, details, created_at")
      .eq("phase", "refresh_matview")
      .gte("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(2000);
    const byMv = new Map<string, { ok_at?: string; err_at?: string; err_msg?: string }>();
    for (const l of logs ?? []) {
      const mv = (l.details as { matview?: string } | null)?.matview;
      if (!mv) continue;
      if (!byMv.has(mv)) byMv.set(mv, {});
      const entry = byMv.get(mv)!;
      if (l.level === "info" && !entry.ok_at) entry.ok_at = l.created_at;
      if (l.level === "error" && !entry.err_at) {
        entry.err_at = l.created_at;
        entry.err_msg = (l.details as { error?: string } | null)?.error;
      }
    }
    const stale: { mv: string; ok_hours: number | null; last_error: string | null }[] = [];
    for (const [mv, e] of byMv) {
      const okH = e.ok_at ? hoursAgo(e.ok_at) : null;
      const errMoreRecent = e.err_at && (!e.ok_at || new Date(e.err_at).getTime() > new Date(e.ok_at).getTime());
      if (errMoreRecent || (okH ?? 0) > 24) {
        stale.push({ mv, ok_hours: okH, last_error: e.err_msg ?? null });
      }
    }
    probes.push({
      probe: "silver_mv_health",
      severity: stale.length > 0 ? "critical" : "ok",
      message: stale.length === 0 ? "Todas las MVs refrescaron OK en las últimas 24h" : `${stale.length} MV(s) atorada(s)`,
      details: { stale: stale.slice(0, 10) },
    });
  } catch (e) {
    probes.push({ probe: "silver_mv_health", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 5. MDM duplicates (canonical_companies)
  try {
    const { data: rows } = await supabase
      .from("canonical_companies")
      .select("odoo_partner_id")
      .not("odoo_partner_id", "is", null);
    const counts = new Map<number, number>();
    for (const r of rows ?? []) counts.set(r.odoo_partner_id as number, (counts.get(r.odoo_partner_id as number) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1);
    probes.push({
      probe: "mdm_duplicates",
      severity: dupes.length > 0 ? "critical" : "ok",
      message: dupes.length === 0
        ? "Sin duplicados en canonical_companies por odoo_partner_id"
        : `${dupes.length} odoo_partner_id con >1 canonical_companies`,
      details: { sample: dupes.slice(0, 10).map(([p, n]) => ({ odoo_partner_id: p, count: n })) },
    });
  } catch (e) {
    probes.push({ probe: "mdm_duplicates", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 6. Gold period freshness
  try {
    const { data: pl } = await supabase
      .from("gold_pl_statement")
      .select("period")
      .order("period", { ascending: false })
      .limit(1);
    const { data: bs } = await supabase
      .from("gold_balance_sheet")
      .select("period")
      .order("period", { ascending: false })
      .limit(1);
    const plPeriod = pl?.[0]?.period as string | undefined;
    const bsPeriod = bs?.[0]?.period as string | undefined;
    const lag = plPeriod ? periodLagDays(plPeriod) : 9999;
    probes.push({
      probe: "gold_periods",
      severity: lag > GOLD_PERIOD_LAG_DAYS * 2 ? "critical" : lag > GOLD_PERIOD_LAG_DAYS ? "warning" : "ok",
      message: `P&L hasta ${plPeriod ?? "?"} · Balance hasta ${bsPeriod ?? "?"} (lag ${lag}d)`,
      details: { pl_period: plPeriod, bs_period: bsPeriod, lag_days: lag },
    });
  } catch (e) {
    probes.push({ probe: "gold_periods", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 7. Open reconciliation issues by invariant
  try {
    const { data } = await supabase
      .from("reconciliation_issues")
      .select("invariant_key, impact_mxn")
      .is("resolved_at", null);
    const agg = new Map<string, { n: number; impact: number }>();
    for (const r of data ?? []) {
      const k = r.invariant_key as string;
      const cur = agg.get(k) ?? { n: 0, impact: 0 };
      cur.n += 1;
      cur.impact += Number(r.impact_mxn ?? 0);
      agg.set(k, cur);
    }
    const top = [...agg.entries()]
      .map(([k, v]) => ({ invariant_key: k, n: v.n, impact_mxn: Math.round(v.impact) }))
      .sort((a, b) => b.impact_mxn - a.impact_mxn)
      .slice(0, 10);
    const total = top.reduce((s, x) => s + x.n, 0);
    probes.push({
      probe: "recon_open_issues",
      severity: top[0]?.impact_mxn > 50_000_000 ? "warning" : "ok",
      message: `${total} issues open en top-10 invariantes · impacto total $${(top.reduce((s, x) => s + x.impact_mxn, 0) / 1e6).toFixed(1)}M`,
      details: top,
    });
  } catch (e) {
    probes.push({ probe: "recon_open_issues", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  // 8. Pipeline_logs error/warning aggregate
  try {
    const { data } = await supabase
      .from("pipeline_logs")
      .select("level, phase")
      .in("level", ["error", "warning", "warn"])
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    const agg = new Map<string, { error: number; warning: number }>();
    for (const r of data ?? []) {
      const cur = agg.get(r.phase as string) ?? { error: 0, warning: 0 };
      if (r.level === "error") cur.error++;
      else cur.warning++;
      agg.set(r.phase as string, cur);
    }
    const errors = [...agg.entries()].filter(([, v]) => v.error > 0);
    probes.push({
      probe: "pipeline_errors_24h",
      severity: errors.length > 0 ? "warning" : "ok",
      message: errors.length === 0
        ? "Sin errores en pipeline_logs en últimas 24h"
        : `${errors.length} fase(s) con errores: ${errors.map(([k]) => k).join(", ")}`,
      details: Object.fromEntries(agg),
    });
  } catch (e) {
    probes.push({ probe: "pipeline_errors_24h", severity: "critical", message: `Error: ${(e as Error).message}` });
  }

  const criticals = probes.filter((p) => p.severity === "critical").length;
  const warnings = probes.filter((p) => p.severity === "warning").length;
  const overall: Severity = criticals > 0 ? "critical" : warnings > 0 ? "warning" : "ok";

  const response: AuditResponse = {
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    overall,
    criticals,
    warnings,
    probes,
  };
  return NextResponse.json(response, { status: overall === "critical" ? 503 : 200 });
}

function hoursAgo(iso: string): number {
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3_600_000) * 100) / 100;
}
function formatH(h: number | null): string {
  if (h === null) return "n/a";
  if (h < 1) return `${Math.round(h * 60)}min atrás`;
  if (h < 48) return `${h.toFixed(1)}h atrás`;
  return `${Math.round(h / 24)}d atrás`;
}
function periodLagDays(period: string): number {
  // period is "YYYY-MM"; compute days from end-of-month to today
  const [y, m] = period.split("-").map(Number);
  const eom = new Date(Date.UTC(y, m, 0));
  return Math.max(0, Math.round((Date.now() - eom.getTime()) / 86_400_000));
}
