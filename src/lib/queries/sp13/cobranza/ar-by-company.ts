import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";
import { paginationRange, type TableParams } from "../../_shared/table-params";

// C3+C5 — companies with AR, joined with payment_predictions for risk flag.

export type ArRiskLabel = "critical" | "abnormal" | "watch" | "normal" | null;

export interface ArByCompanyRow {
  companyId: number;
  companyName: string | null;
  tier: string | null;
  totalReceivable: number;
  overdueTotal: number;
  oldestDays: number | null;
  risk: ArRiskLabel;
  salespersonName: string | null;
}

export interface ArByCompanyPage {
  rows: ArByCompanyRow[];
  total: number;
}

export type ArByCompanyParams = TableParams & {
  bucket?: string[]; // subset of "1-30" | "31-60" | "61-90" | "90+"
  risk?: string[]; // "all" ignored upstream; "critical" filters to critical only
};

const SORT_MAP: Record<string, string> = {
  total: "total_receivable",
  overdue:
    // pseudo — we sort in-memory since cash_flow_aging has no combined overdue
    "overdue_combined",
  oldest: "oldest_days",
  company: "company_name",
};

/**
 * Map raw `payment_predictions.payment_risk` string (Spanish/English with
 * mixed casing) to the canonical 4-bucket label. Returns null for unknown
 * inputs. Same semantics as action-list.ts — kept local to avoid cross-file
 * coupling on unstable internal exports.
 */
export function normalizeRisk(raw: string | null | undefined): ArRiskLabel {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITIC")) return "critical";
  if (upper.startsWith("ANORMAL") || upper.startsWith("ABNORMAL")) return "abnormal";
  if (upper.startsWith("VIGIL") || upper.startsWith("WATCH")) return "watch";
  if (upper.startsWith("NORMAL")) return "normal";
  return null;
}

/**
 * Translate UI bucket selection (subset of "1-30" | "31-60" | "61-90" | "90+")
 * to PostgREST `.or()` fragments referencing the cash_flow_aging columns.
 * Empty input → empty array (caller skips the filter).
 */
export function bucketOrFilters(buckets: string[]): string[] {
  const out: string[] = [];
  if (buckets.includes("1-30")) out.push("overdue_1_30.gt.0");
  if (buckets.includes("31-60")) out.push("overdue_31_60.gt.0");
  if (buckets.includes("61-90")) out.push("overdue_61_90.gt.0");
  if (buckets.includes("90+")) out.push("overdue_90plus.gt.0");
  return out;
}

export async function getArByCompany(
  params: ArByCompanyParams
): Promise<ArByCompanyPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortKey = (params.sort && SORT_MAP[params.sort]) ?? "total_receivable";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("cash_flow_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue",
      { count: "exact" }
    )
    .gt("total_receivable", 0)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);

  if (params.bucket && params.bucket.length > 0) {
    const orParts = bucketOrFilters(params.bucket);
    if (orParts.length > 0) query = query.or(orParts.join(","));
  }

  // For real DB-sortable columns use order directly; otherwise fall back to client sort.
  const canServerSort =
    sortKey === "total_receivable" ||
    sortKey === "company_name";
  if (canServerSort) {
    query = query.order(sortKey, { ascending, nullsFirst: false });
  } else {
    query = query.order("total_receivable", { ascending: false, nullsFirst: false });
  }

  const { data, count } = await query.range(start, end);

  type CfaRow = {
    company_id: number | null;
    company_name: string | null;
    tier: string | null;
    current_amount: number | null;
    overdue_1_30: number | null;
    overdue_31_60: number | null;
    overdue_61_90: number | null;
    overdue_90plus: number | null;
    total_receivable: number | null;
  };

  const cfaRows = (data ?? []) as CfaRow[];
  const companyIds = cfaRows
    .map((r) => r.company_id)
    .filter((id): id is number => id != null);

  // Parallel joins: payment_predictions (risk) + oldest due_date per company.
  const [predictionsResp, oldestResp] = await Promise.all([
    companyIds.length > 0
      ? sb
          .from("payment_predictions")
          .select("company_id, payment_risk, max_days_overdue")
          .in("company_id", companyIds)
      : Promise.resolve({ data: [] as Array<{ company_id: number; payment_risk: string | null; max_days_overdue: number | null }> }),
    companyIds.length > 0
      ? sb
          .from("canonical_invoices")
          .select(
            "receptor_canonical_company_id, due_date_resolved, due_date_odoo, amount_residual_mxn_resolved, amount_residual_mxn_odoo"
          )
          // Tombstone filter (see migration 20260426): exclude personal CFDIs.
          .eq("is_quimibond_relevant", true)
          .eq("direction", "issued")
          .neq("estado_sat", "cancelado")
          .in("payment_state_odoo", ["not_paid", "partial"])
          .or("amount_residual_mxn_resolved.gt.0.01,amount_residual_mxn_odoo.gt.0.01")
          .in("receptor_canonical_company_id", companyIds)
      : Promise.resolve({ data: [] as Array<{
          receptor_canonical_company_id: number | null;
          due_date_resolved: string | null;
          due_date_odoo: string | null;
          amount_residual_mxn_resolved: number | null;
          amount_residual_mxn_odoo: number | null;
        }> }),
  ]);

  const riskByCompany = new Map<number, ArRiskLabel>();
  for (const p of (predictionsResp.data ?? []) as Array<{
    company_id: number | null;
    payment_risk: string | null;
  }>) {
    if (p.company_id == null) continue;
    riskByCompany.set(p.company_id, normalizeRisk(p.payment_risk));
  }

  const today = Date.now();
  const oldestByCompany = new Map<number, number>();
  for (const inv of (oldestResp.data ?? []) as Array<{
    receptor_canonical_company_id: number | null;
    due_date_resolved: string | null;
    due_date_odoo: string | null;
  }>) {
    const cid = inv.receptor_canonical_company_id;
    if (cid == null) continue;
    const due = inv.due_date_resolved ?? inv.due_date_odoo;
    if (!due) continue;
    const days = Math.floor((today - new Date(due).getTime()) / 86400000);
    if (days <= 0) continue;
    const prev = oldestByCompany.get(cid) ?? 0;
    if (days > prev) oldestByCompany.set(cid, days);
  }

  let rows: ArByCompanyRow[] = cfaRows.map((r) => {
    const companyId = Number(r.company_id) || 0;
    const overdue =
      (Number(r.overdue_1_30) || 0) +
      (Number(r.overdue_31_60) || 0) +
      (Number(r.overdue_61_90) || 0) +
      (Number(r.overdue_90plus) || 0);
    return {
      companyId,
      companyName: r.company_name ?? null,
      tier: r.tier ?? null,
      totalReceivable: Number(r.total_receivable) || 0,
      overdueTotal: overdue,
      oldestDays: oldestByCompany.get(companyId) ?? null,
      risk: riskByCompany.get(companyId) ?? null,
      salespersonName: null,
    };
  });

  // Risk filter (applied post-fetch; cash_flow_aging has no risk column).
  if (params.risk && params.risk.length > 0 && !params.risk.includes("all")) {
    const wanted = new Set(params.risk);
    rows = rows.filter((r) => r.risk != null && wanted.has(r.risk));
  }

  // In-memory sort for pseudo-columns.
  if (!["total_receivable", "company_name"].includes(sortKey)) {
    const key: keyof ArByCompanyRow =
      sortKey === "oldest_days" ? "oldestDays" : "overdueTotal";
    rows = [...rows].sort((a, b) => {
      const av = Number(a[key] ?? 0);
      const bv = Number(b[key] ?? 0);
      return ascending ? av - bv : bv - av;
    });
  }

  return { rows, total: count ?? rows.length };
}
