import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";

// Aging snapshot as-of today. 5 buckets: current | 1-30 | 31-60 | 61-90 | 90+.

export type AgingBucketKey =
  | "current"
  | "d1_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus";

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amountMxn: number;
  count: number;
}

export interface AgingBucketsResult {
  totals: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  counts: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  buckets: AgingBucket[];
}

type OpenInv = {
  amount_residual_mxn_resolved: number | null;
  amount_residual_mxn_odoo: number | null;
  due_date_resolved: string | null;
  due_date_odoo: string | null;
};

function residual(r: OpenInv): number {
  return Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
}

function dueDate(r: OpenInv): string | null {
  return r.due_date_resolved ?? r.due_date_odoo;
}

async function _getAgingBucketsRaw(): Promise<AgingBucketsResult> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("canonical_invoices")
    .select(
      "amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo"
    )
    // Tombstone filter (see migration 20260426): exclude personal CFDIs.
    .eq("is_quimibond_relevant", true)
    .eq("direction", "issued")
    .neq("estado_sat", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .or("amount_residual_mxn_resolved.gt.0.01,amount_residual_mxn_odoo.gt.0.01")
    .not("receptor_canonical_company_id", "in", pgInList(selfIds));

  const rows = (data ?? []) as OpenInv[];
  const today = Date.now();

  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const counts = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };

  for (const r of rows) {
    const amt = residual(r);
    if (amt <= 0) continue;
    const due = dueDate(r);
    const days = due
      ? Math.floor((today - new Date(due).getTime()) / 86400000)
      : 0;
    let k: AgingBucketKey;
    if (days <= 0) k = "current";
    else if (days <= 30) k = "d1_30";
    else if (days <= 60) k = "d31_60";
    else if (days <= 90) k = "d61_90";
    else k = "d90_plus";
    totals[k] += amt;
    counts[k] += 1;
  }

  const buckets: AgingBucket[] = [
    { key: "current", label: "Corriente", amountMxn: totals.current, count: counts.current },
    { key: "d1_30", label: "1-30", amountMxn: totals.d1_30, count: counts.d1_30 },
    { key: "d31_60", label: "31-60", amountMxn: totals.d31_60, count: counts.d31_60 },
    { key: "d61_90", label: "61-90", amountMxn: totals.d61_90, count: counts.d61_90 },
    { key: "d90_plus", label: "90+", amountMxn: totals.d90_plus, count: counts.d90_plus },
  ];

  return { totals, counts, buckets };
}

export const getAgingBuckets = unstable_cache(
  _getAgingBucketsRaw,
  ["sp13-cobranza-aging-buckets-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);
