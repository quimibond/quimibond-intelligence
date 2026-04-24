import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F-anomalies — Accounting anomalies banner.
 *
 * Source: `accounting_anomalies` (refreshed daily by pg_cron). Each row is
 * a pre-calculated red flag (credit limit exceeded, duplicate invoice,
 * stale receivable, supplier overdue, unusual credit note, CFDI cancelled).
 *
 * The frontend shows a summary count and the top-3 most recent `critical`
 * or `high` items. Full drilldown lives on a future /sistema?tab=anomalies
 * page; do not bloat /finanzas with the full list.
 */
export type AnomalySeverity = "critical" | "high" | "medium" | "low";

export interface AnomalyRow {
  anomalyType: string;
  severity: AnomalySeverity;
  description: string;
  companyId: number | null;
  companyName: string | null;
  amount: number | null;
  detectedDate: string | null;
}

export interface AnomaliesSummary {
  totalCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  topItems: AnomalyRow[];
  latestDetectedDate: string | null;
}

async function _getAnomaliesSummaryRaw(): Promise<AnomaliesSummary> {
  const sb = getServiceClient();

  const [countsRes, topRes] = await Promise.all([
    sb
      .from("accounting_anomalies")
      .select("severity, detected_date"),
    sb
      .from("accounting_anomalies")
      .select(
        "anomaly_type, severity, description, company_id, company_name, amount, detected_date"
      )
      .in("severity", ["critical", "high"])
      .order("detected_date", { ascending: false })
      .order("amount", { ascending: false, nullsFirst: false })
      .limit(3),
  ]);

  type CountRow = { severity: string | null; detected_date: string | null };
  const allRows = (countsRes.data ?? []) as CountRow[];

  let critical = 0;
  let high = 0;
  let medium = 0;
  let latest: string | null = null;
  for (const r of allRows) {
    if (r.severity === "critical") critical++;
    else if (r.severity === "high") high++;
    else if (r.severity === "medium") medium++;
    if (r.detected_date && (!latest || r.detected_date > latest)) {
      latest = r.detected_date;
    }
  }

  type TopRow = {
    anomaly_type: string | null;
    severity: string | null;
    description: string | null;
    company_id: number | null;
    company_name: string | null;
    amount: number | null;
    detected_date: string | null;
  };
  const topItems: AnomalyRow[] = ((topRes.data ?? []) as TopRow[]).map((r) => ({
    anomalyType: r.anomaly_type ?? "unknown",
    severity: (r.severity as AnomalySeverity) ?? "medium",
    description: r.description ?? "",
    companyId: r.company_id,
    companyName: r.company_name,
    amount: r.amount == null ? null : Number(r.amount),
    detectedDate: r.detected_date,
  }));

  return {
    totalCount: allRows.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    topItems,
    latestDetectedDate: latest,
  };
}

export const getAnomaliesSummary = unstable_cache(
  _getAnomaliesSummaryRaw,
  ["sp13-finanzas-anomalies-summary"],
  { revalidate: 300, tags: ["finanzas"] }
);
