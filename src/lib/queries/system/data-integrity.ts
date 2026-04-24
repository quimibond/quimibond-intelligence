import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Data integrity checks — daily audit results from data_integrity_runs.
 *
 * Source tables (managed entirely in Supabase):
 * - `data_integrity_checks`  — catalog of checks (16 seeded 2026-04-24)
 * - `data_integrity_runs`    — historical run results, one row per check per run
 * - pg_cron `data_integrity_daily` at 06:30 UTC invokes
 *   `run_data_integrity_checks()` which writes new run rows
 *
 * Fix policy: if a check fails, the fix goes in silver/canonical (SQL).
 * The frontend only surfaces the status.
 */
export interface IntegrityCheckStatus {
  checkKey: string;
  category: string;
  severity: "info" | "warning" | "critical";
  tableName: string;
  description: string;
  toleranceCount: number;
  failCount: number;
  prevFailCount: number | null;
  delta: number | null;
  exceededTolerance: boolean;
  runAt: string | null;
  errorMessage: string | null;
}

export interface IntegrityOverview {
  total: number;
  failing: number;
  passing: number;
  errors: number;
  lastRunAt: string | null;
  checks: IntegrityCheckStatus[];
}

async function _getDataIntegrityStatusRaw(): Promise<IntegrityOverview> {
  const sb = getServiceClient();

  const [defsRes, latestRes] = await Promise.all([
    sb
      .from("data_integrity_checks")
      .select(
        "check_key, category, severity, table_name, description, tolerance_count, enabled"
      )
      .eq("enabled", true),
    // Latest run per check via a window function would be ideal; REST-friendly
    // approach: pull last 500 runs and pick the most recent per key client-side.
    sb
      .from("data_integrity_runs")
      .select(
        "check_key, run_at, fail_count, prev_fail_count, delta, exceeded_tolerance, error_message"
      )
      .order("run_at", { ascending: false })
      .limit(500),
  ]);

  type Def = {
    check_key: string;
    category: string;
    severity: "info" | "warning" | "critical";
    table_name: string;
    description: string;
    tolerance_count: number;
    enabled: boolean;
  };
  type Run = {
    check_key: string;
    run_at: string;
    fail_count: number;
    prev_fail_count: number | null;
    delta: number | null;
    exceeded_tolerance: boolean;
    error_message: string | null;
  };

  const defs = (defsRes.data ?? []) as Def[];
  const runs = (latestRes.data ?? []) as Run[];

  const latestByKey = new Map<string, Run>();
  for (const run of runs) {
    if (!latestByKey.has(run.check_key)) {
      latestByKey.set(run.check_key, run);
    }
  }

  const checks: IntegrityCheckStatus[] = defs.map((d) => {
    const run = latestByKey.get(d.check_key);
    return {
      checkKey: d.check_key,
      category: d.category,
      severity: d.severity,
      tableName: d.table_name,
      description: d.description,
      toleranceCount: d.tolerance_count,
      failCount: run?.fail_count ?? 0,
      prevFailCount: run?.prev_fail_count ?? null,
      delta: run?.delta ?? null,
      exceededTolerance: run?.exceeded_tolerance ?? false,
      runAt: run?.run_at ?? null,
      errorMessage: run?.error_message ?? null,
    };
  });

  checks.sort((a, b) => {
    // failing → error → passing; within each group alphabetical by key
    const rankA = a.exceededTolerance ? 0 : a.errorMessage ? 1 : 2;
    const rankB = b.exceededTolerance ? 0 : b.errorMessage ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    return a.checkKey.localeCompare(b.checkKey);
  });

  const lastRunAt = runs[0]?.run_at ?? null;
  return {
    total: checks.length,
    failing: checks.filter((c) => c.exceededTolerance).length,
    passing: checks.filter((c) => !c.exceededTolerance && !c.errorMessage).length,
    errors: checks.filter((c) => !!c.errorMessage).length,
    lastRunAt,
    checks,
  };
}

export const getDataIntegrityStatus = unstable_cache(
  _getDataIntegrityStatusRaw,
  ["sp13-data-integrity-status"],
  { revalidate: 300, tags: ["system"] }
);
