import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";

// C6 — top-N overdue invoices, prioritised by:
//   score = overdue_amount × probability_no_pay × days_overdue_factor
// where probability_no_pay ≈ mapping(payment_risk) and days_overdue_factor = log1p(days).

export type ActionRiskLabel = "critical" | "abnormal" | "watch" | "normal" | null;

export interface ActionListItem {
  invoiceId: string;
  invoiceName: string | null;
  companyId: number | null;
  companyName: string | null;
  amountOverdueMxn: number;
  daysOverdue: number;
  dueDate: string | null;
  risk: ActionRiskLabel;
  score: number;
}

const RISK_WEIGHT: Record<string, number> = {
  critical: 0.9,
  abnormal: 0.6,
  watch: 0.35,
  normal: 0.15,
};

function normalizeRisk(raw: string | null | undefined): ActionRiskLabel {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITIC")) return "critical";
  if (upper.startsWith("ANORMAL") || upper.startsWith("ABNORMAL")) return "abnormal";
  if (upper.startsWith("VIGIL") || upper.startsWith("WATCH")) return "watch";
  if (upper.startsWith("NORMAL")) return "normal";
  return null;
}

async function _getActionListRaw(top: number): Promise<ActionListItem[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 1) Over-fetch a pool of overdue invoices so the post-scoring top-N is stable.
  const POOL = Math.max(top * 10, 200);
  const { data } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, odoo_invoice_id, odoo_name, odoo_ref, receptor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo"
    )
    // Tombstone filter (see migration 20260426): exclude personal CFDIs.
    .eq("is_quimibond_relevant", true)
    .eq("direction", "issued")
    .neq("estado_sat", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .lt("due_date_odoo", todayStr)
    .or("amount_residual_mxn_resolved.gt.0.01,amount_residual_mxn_odoo.gt.0.01")
    .not("receptor_canonical_company_id", "in", pgInList(selfIds))
    .order("amount_residual_mxn_odoo", { ascending: false, nullsFirst: false })
    .limit(POOL);

  type Row = {
    canonical_id: string | null;
    odoo_invoice_id: number | null;
    odoo_name: string | null;
    odoo_ref: string | null;
    receptor_canonical_company_id: number | null;
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
    due_date_resolved: string | null;
    due_date_odoo: string | null;
  };

  const rows = (data ?? []) as Row[];
  const companyIds = Array.from(
    new Set(
      rows
        .map((r) => r.receptor_canonical_company_id)
        .filter((id): id is number => id != null)
    )
  );

  // 2) Lookup risk + company name in parallel.
  const [predResp, compResp] = await Promise.all([
    companyIds.length > 0
      ? sb
          .from("payment_predictions")
          .select("company_id, payment_risk, company_name")
          .in("company_id", companyIds)
      : Promise.resolve({ data: [] as Array<{ company_id: number; payment_risk: string | null; company_name: string | null }> }),
    companyIds.length > 0
      ? sb
          .from("canonical_companies")
          .select("id, display_name")
          .in("id", companyIds)
      : Promise.resolve({ data: [] as Array<{ id: number; display_name: string | null }> }),
  ]);

  const riskByCompany = new Map<number, ActionRiskLabel>();
  const nameFromPredictions = new Map<number, string>();
  for (const p of (predResp.data ?? []) as Array<{
    company_id: number | null;
    payment_risk: string | null;
    company_name: string | null;
  }>) {
    if (p.company_id == null) continue;
    riskByCompany.set(p.company_id, normalizeRisk(p.payment_risk));
    if (p.company_name) nameFromPredictions.set(p.company_id, p.company_name);
  }
  const nameFromCompanies = new Map<number, string>();
  for (const c of (compResp.data ?? []) as Array<{
    id: number | null;
    display_name: string | null;
  }>) {
    if (c.id == null) continue;
    if (c.display_name) nameFromCompanies.set(c.id, c.display_name);
  }

  // 3) Score and rank.
  const todayMs = today.getTime();
  const scored: ActionListItem[] = rows
    .map((r) => {
      const amt = Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
      const due = r.due_date_resolved ?? r.due_date_odoo;
      const daysOverdue = due
        ? Math.max(0, Math.floor((todayMs - new Date(due).getTime()) / 86400000))
        : 0;
      if (amt <= 0 || daysOverdue <= 0) return null;
      const cid = r.receptor_canonical_company_id;
      const risk = cid != null ? riskByCompany.get(cid) ?? null : null;
      const riskWeight = risk ? RISK_WEIGHT[risk] : 0.3; // default for unknown risk
      const daysFactor = Math.log1p(daysOverdue);
      const score = amt * riskWeight * daysFactor;
      const companyName =
        (cid != null ? nameFromCompanies.get(cid) : null) ??
        (cid != null ? nameFromPredictions.get(cid) : null) ??
        null;
      return {
        invoiceId: r.canonical_id ?? String(r.odoo_invoice_id ?? ""),
        invoiceName: r.odoo_name ?? r.odoo_ref ?? null,
        companyId: cid,
        companyName,
        amountOverdueMxn: amt,
        daysOverdue,
        dueDate: due,
        risk,
        score,
      } satisfies ActionListItem;
    })
    .filter((x): x is ActionListItem => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);

  return scored;
}

export async function getActionList(top = 20): Promise<ActionListItem[]> {
  const cached = unstable_cache(
    () => _getActionListRaw(top),
    ["sp13-cobranza-action-list-v1", String(top)],
    { revalidate: 60, tags: ["invoices-unified"] }
  );
  return cached();
}
