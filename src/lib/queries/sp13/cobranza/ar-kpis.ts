import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";
import { paginateAll } from "../../_shared/paginate";

// AR snapshot is always "today" — the period param only scopes DSO / collections.
// Source: canonical_invoices where direction='issued', not cancelled, residual > 0.

export interface ArKpis {
  totalMxn: number;
  totalCount: number;
  overdueMxn: number;
  overdueCount: number;
  overdue90plusMxn: number;
  overdue90plusCount: number;
  dsoDays: number | null;
}

const OPEN_FILTER =
  "amount_residual_mxn_resolved.gt.0.01,amount_residual_mxn_odoo.gt.0.01";

type OpenInv = {
  amount_residual_mxn_resolved: number | null;
  amount_residual_mxn_odoo: number | null;
  due_date_resolved: string | null;
  due_date_odoo: string | null;
  receptor_canonical_company_id: number | null;
};

function residual(r: OpenInv): number {
  return Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
}

function dueDate(r: OpenInv): string | null {
  return r.due_date_resolved ?? r.due_date_odoo;
}

async function _getArKpisRaw(): Promise<ArKpis> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const today = new Date().toISOString().slice(0, 10);
  const cutoffYear = new Date();
  cutoffYear.setFullYear(cutoffYear.getFullYear() - 1);
  const yearCutoff = cutoffYear.toISOString().slice(0, 10);

  // openAr is small (~378 rows); revenue12m exceeds 1000 (audit 2026-04-29:
  // 2,433 issued in last 365d). Paginate the latter.
  type RevRow = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const [openAr, revenue12mRows] = await Promise.all([
    sb
      .from("canonical_invoices")
      .select(
        "amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo, receptor_canonical_company_id"
      )
      // Tombstone filter (see migration 20260426): exclude personal CFDIs.
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or(OPEN_FILTER)
      .not("receptor_canonical_company_id", "in", pgInList(selfIds)),
    paginateAll<RevRow>(({ from, to }) =>
      sb
        .from("canonical_invoices")
        .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
        // Tombstone filter (see migration 20260426): exclude personal CFDIs.
        .eq("is_quimibond_relevant", true)
        .eq("direction", "issued")
        .or("estado_sat.is.null,estado_sat.neq.cancelado")
        .gte("invoice_date", yearCutoff)
        .order("invoice_date", { ascending: true })
        .order("canonical_id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const arRows = (openAr.data ?? []) as OpenInv[];
  const totalMxn = arRows.reduce((s, r) => s + residual(r), 0);
  const totalCount = arRows.length;

  const overdue = arRows.filter((r) => {
    const due = dueDate(r);
    return due != null && due < today;
  });
  const overdueMxn = overdue.reduce((s, r) => s + residual(r), 0);
  const overdueCount = overdue.length;

  const d90 = new Date();
  d90.setDate(d90.getDate() - 90);
  const cutoff90 = d90.toISOString().slice(0, 10);
  const veryOverdue = overdue.filter((r) => {
    const due = dueDate(r);
    return due != null && due < cutoff90;
  });
  const overdue90plusMxn = veryOverdue.reduce((s, r) => s + residual(r), 0);
  const overdue90plusCount = veryOverdue.length;

  const revenue12mMxn = revenue12mRows.reduce(
    (s, r) => s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );
  const dsoDays =
    revenue12mMxn > 0 ? Math.round((totalMxn / revenue12mMxn) * 365) : null;

  return {
    totalMxn,
    totalCount,
    overdueMxn,
    overdueCount,
    overdue90plusMxn,
    overdue90plusCount,
    dsoDays,
  };
}

export const getArKpis = unstable_cache(_getArKpisRaw, ["sp13-cobranza-ar-kpis-v3-paginated-revenue"], {
  revalidate: 60,
  tags: ["invoices-unified", "finance"],
});
