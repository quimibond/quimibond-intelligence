import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F4 — Working capital.
 *
 * Single-source-of-truth reads:
 * - `gold_cashflow`       → headline AR / AP / overdue / working capital.
 *   Single-row materialised view refreshed hourly. Authoritative.
 * - `canonical_companies` → per-company aggregates for the top-10 tables:
 *   total_receivable_mxn, overdue_amount_mxn, overdue_count, total_payable_mxn.
 *   Refreshed by `refresh_canonical_company_financials` hourly.
 * - `canonical_invoices`  → 365d revenue / COGS totals for DSO / DPO
 *   denominators (no residual columns, no aggregate dependency).
 *
 * If these aggregates ever show drift vs reality, the fix goes into the
 * silver layer (see docs/DATA_INTEGRITY.md), not this file.
 */
export interface WorkingCapitalContributor {
  companyId: number | null;
  companyName: string | null;
  totalMxn: number;
  overdueMxn: number;
  invoiceCount: number;
  overdueCount: number;
}

export interface WorkingCapitalSummary {
  arTotalMxn: number;
  arOverdueMxn: number;
  arOverdueCount: number;
  arCompaniesCount: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  apOverdueCount: number;
  apCompaniesCount: number;
  netoMxn: number;
  workingCapitalMxn: number;
  topAr: WorkingCapitalContributor[];
  topAp: WorkingCapitalContributor[];
  dsoDays: number | null;
  dpoDays: number | null;
  asOfDate: string | null;
}

type CompanyAgg = {
  id: number;
  display_name: string | null;
  total_receivable_mxn: number | null;
  overdue_amount_mxn: number | null;
  overdue_count: number | null;
  total_payable_mxn: number | null;
};

async function _getWorkingCapitalRaw(): Promise<WorkingCapitalSummary> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    cashflow,
    arTop,
    apTop,
    arCompaniesAgg,
    apCompaniesAgg,
    revenue365,
    cogs365,
    apOverdue,
  ] = await Promise.all([
    sb
      .from("gold_cashflow")
      .select(
        "total_receivable_mxn, overdue_receivable_mxn, total_payable_mxn, working_capital_mxn, refreshed_at"
      )
      .maybeSingle(),
    sb
      .from("canonical_companies")
      .select(
        "id, display_name, total_receivable_mxn, overdue_amount_mxn, overdue_count, total_payable_mxn"
      )
      .gt("total_receivable_mxn", 0)
      .order("total_receivable_mxn", { ascending: false })
      .limit(10),
    sb
      .from("canonical_companies")
      .select(
        "id, display_name, total_receivable_mxn, overdue_amount_mxn, overdue_count, total_payable_mxn"
      )
      .gt("total_payable_mxn", 0)
      .order("total_payable_mxn", { ascending: false })
      .limit(10),
    // FULL aggregate across all AR companies for accurate total overdue count
    sb
      .from("canonical_companies")
      .select("total_receivable_mxn, overdue_count")
      .gt("total_receivable_mxn", 0),
    sb
      .from("canonical_companies")
      .select("total_payable_mxn")
      .gt("total_payable_mxn", 0),
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_odoo, amount_total_mxn_resolved")
      .eq("direction", "issued")
      .gte("invoice_date", daysAgoIso(365)),
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_odoo, amount_total_mxn_resolved")
      .eq("direction", "received")
      .gte("invoice_date", daysAgoIso(365)),
    // AP overdue: count + amount from invoice level (no company aggregate exists)
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_odoo, due_date_odoo, emisor_canonical_company_id")
      .eq("direction", "received")
      .gt("amount_residual_mxn_odoo", 0)
      .lt("due_date_odoo", today),
  ]);

  type Cashflow = {
    total_receivable_mxn: number | null;
    overdue_receivable_mxn: number | null;
    total_payable_mxn: number | null;
    working_capital_mxn: number | null;
    refreshed_at: string | null;
  };
  const cf = (cashflow.data ?? null) as Cashflow | null;

  const arTotal = Number(cf?.total_receivable_mxn) || 0;
  const arOverdueTotal = Number(cf?.overdue_receivable_mxn) || 0;
  const apTotal = Number(cf?.total_payable_mxn) || 0;
  const wcTotal = Number(cf?.working_capital_mxn) || arTotal - apTotal;

  const topAr: WorkingCapitalContributor[] = (
    (arTop.data ?? []) as CompanyAgg[]
  ).map((r) => ({
    companyId: r.id,
    companyName: r.display_name,
    totalMxn: Number(r.total_receivable_mxn) || 0,
    overdueMxn: Number(r.overdue_amount_mxn) || 0,
    invoiceCount: Number(r.overdue_count) || 0,
    overdueCount: Number(r.overdue_count) || 0,
  }));

  // Compute AP overdue per-company from invoice level (no canonical_companies field exists)
  type ApOverdue = {
    amount_residual_mxn_odoo: number | null;
    emisor_canonical_company_id: number | null;
  };
  const apOverdueRows = (apOverdue.data ?? []) as ApOverdue[];
  const apOverdueByCompany = new Map<number, { total: number; count: number }>();
  let apOverdueTotalMxn = 0;
  for (const r of apOverdueRows) {
    const amt = Number(r.amount_residual_mxn_odoo) || 0;
    apOverdueTotalMxn += amt;
    if (r.emisor_canonical_company_id != null) {
      const ex = apOverdueByCompany.get(r.emisor_canonical_company_id) ?? {
        total: 0,
        count: 0,
      };
      ex.total += amt;
      ex.count++;
      apOverdueByCompany.set(r.emisor_canonical_company_id, ex);
    }
  }

  const topAp: WorkingCapitalContributor[] = (
    (apTop.data ?? []) as CompanyAgg[]
  ).map((r) => {
    const od = apOverdueByCompany.get(r.id) ?? { total: 0, count: 0 };
    return {
      companyId: r.id,
      companyName: r.display_name,
      totalMxn: Number(r.total_payable_mxn) || 0,
      overdueMxn: od.total,
      invoiceCount: od.count,
      overdueCount: od.count,
    };
  });

  // Full overdue count across ALL AR companies (not just top 10)
  type ArAgg = { overdue_count: number | null };
  const arOverdueCount = ((arCompaniesAgg.data ?? []) as ArAgg[]).reduce(
    (s, r) => s + (Number(r.overdue_count) || 0),
    0
  );
  const arCompaniesCount = (arCompaniesAgg.data ?? []).length;
  const apCompaniesCount = (apCompaniesAgg.data ?? []).length;
  const apOverdueCount = apOverdueRows.length;

  // DSO/DPO: rolling 365d revenue / COGS
  type InvoiceTotal = {
    amount_total_mxn_odoo: number | null;
    amount_total_mxn_resolved: number | null;
  };
  const totalMxn = (r: InvoiceTotal) =>
    Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0;
  const revenue365Mxn = ((revenue365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + totalMxn(r),
    0
  );
  const cogs365Mxn = ((cogs365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + totalMxn(r),
    0
  );
  const dsoDays = revenue365Mxn > 0 ? Math.round((arTotal / revenue365Mxn) * 365) : null;
  const dpoDays = cogs365Mxn > 0 ? Math.round((apTotal / cogs365Mxn) * 365) : null;

  return {
    arTotalMxn: arTotal,
    arOverdueMxn: arOverdueTotal,
    arOverdueCount,
    arCompaniesCount,
    apTotalMxn: apTotal,
    apOverdueMxn: apOverdueTotalMxn,
    apOverdueCount,
    apCompaniesCount,
    netoMxn: arTotal - apTotal,
    workingCapitalMxn: wcTotal,
    topAr,
    topAp,
    dsoDays,
    dpoDays,
    asOfDate: cf?.refreshed_at ?? null,
  };
}

export const getWorkingCapital = unstable_cache(
  _getWorkingCapitalRaw,
  ["sp13-finanzas-working-capital-gold"],
  { revalidate: 60, tags: ["finanzas"] }
);

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
