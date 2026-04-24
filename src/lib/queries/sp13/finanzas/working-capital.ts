import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F4 — Working capital.
 *
 * Sources (both pre-computed by pg_cron → guaranteed consistent):
 * - `gold_cashflow`        → headline totals (AR / AP / cash / debt / working capital).
 *   Single-row materialised snapshot. This is the authoritative number that
 *   matches /cobranza, /compras and the balance sheet.
 * - `canonical_companies`  → per-company aggregates (total_receivable_mxn,
 *   overdue_amount_mxn, overdue_count, total_payable_mxn, revenue_90d_mxn,
 *   display_name). Refreshed hourly by refresh_canonical_company_financials.
 *
 * Previously this helper iterated canonical_invoices and re-filtered by
 * state/estado — which silently excluded Odoo-only invoices whose
 * estado_sat IS NULL (PostgREST neq excludes nulls). That lost ~$3.8M of
 * AR vs. the authoritative gold_cashflow total. Reading the aggregates
 * directly removes the drift.
 */
export interface WorkingCapitalContributor {
  companyId: number | null;
  companyName: string | null;
  totalMxn: number;
  overdueMxn: number;
  invoiceCount: number;
}

export interface WorkingCapitalSummary {
  arTotalMxn: number;
  arOverdueMxn: number;
  arCompaniesCount: number;
  arOverdueCount: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  apCompaniesCount: number;
  apOverdueCount: number;
  netoMxn: number;
  topAr: WorkingCapitalContributor[];
  topAp: WorkingCapitalContributor[];
  dsoDays: number | null;
  dpoDays: number | null;
  asOfDate: string | null;
}

type CompanyAggregates = {
  id: number;
  display_name: string | null;
  total_receivable_mxn: number | null;
  overdue_amount_mxn: number | null;
  overdue_count: number | null;
  total_payable_mxn: number | null;
};

async function _getWorkingCapitalRaw(): Promise<WorkingCapitalSummary> {
  const sb = getServiceClient();

  const [cashflowRes, arCompanies, apCompanies, revenue365, cogs365] =
    await Promise.all([
      sb
        .from("gold_cashflow")
        .select("total_receivable_mxn, overdue_receivable_mxn, total_payable_mxn, refreshed_at")
        .maybeSingle(),
      // Top AR contributors + count of companies with open AR
      sb
        .from("canonical_companies")
        .select(
          "id, display_name, total_receivable_mxn, overdue_amount_mxn, overdue_count, total_payable_mxn"
        )
        .gt("total_receivable_mxn", 0)
        .order("total_receivable_mxn", { ascending: false }),
      // Top AP contributors
      sb
        .from("canonical_companies")
        .select(
          "id, display_name, total_receivable_mxn, overdue_amount_mxn, overdue_count, total_payable_mxn"
        )
        .gt("total_payable_mxn", 0)
        .order("total_payable_mxn", { ascending: false }),
      // 365d revenue for DSO
      sb
        .from("canonical_invoices")
        .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
        .eq("direction", "issued")
        .gte("invoice_date", daysAgoIso(365)),
      // 365d AP flow for DPO
      sb
        .from("canonical_invoices")
        .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
        .eq("direction", "received")
        .gte("invoice_date", daysAgoIso(365)),
    ]);

  type Cashflow = {
    total_receivable_mxn: number | null;
    overdue_receivable_mxn: number | null;
    total_payable_mxn: number | null;
    refreshed_at: string | null;
  };
  const cf = (cashflowRes.data ?? null) as Cashflow | null;

  const arRows = (arCompanies.data ?? []) as CompanyAggregates[];
  const apRows = (apCompanies.data ?? []) as CompanyAggregates[];

  const topAr: WorkingCapitalContributor[] = arRows.slice(0, 10).map((r) => ({
    companyId: r.id,
    companyName: r.display_name,
    totalMxn: Number(r.total_receivable_mxn) || 0,
    overdueMxn: Number(r.overdue_amount_mxn) || 0,
    invoiceCount: Number(r.overdue_count) || 0,
  }));
  const topAp: WorkingCapitalContributor[] = apRows.slice(0, 10).map((r) => ({
    companyId: r.id,
    companyName: r.display_name,
    totalMxn: Number(r.total_payable_mxn) || 0,
    overdueMxn: 0, // AP overdue not tracked at company level yet
    invoiceCount: 0,
  }));

  // Overdue count across all AR companies (not just top-10)
  const arOverdueCount = arRows.reduce(
    (s, r) => s + (Number(r.overdue_count) || 0),
    0
  );

  // Headline totals from gold_cashflow (authoritative)
  const arTotal = Number(cf?.total_receivable_mxn) || 0;
  const arOverdueTotal = Number(cf?.overdue_receivable_mxn) || 0;
  const apTotal = Number(cf?.total_payable_mxn) || 0;

  // DSO/DPO: rolling 365d revenue / COGS × AR or AP / revenue or COGS
  type InvoiceTotal = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const revenue365Mxn = ((revenue365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) =>
      s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );
  const cogs365Mxn = ((cogs365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) =>
      s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );
  const dsoDays = revenue365Mxn > 0 ? Math.round((arTotal / revenue365Mxn) * 365) : null;
  const dpoDays = cogs365Mxn > 0 ? Math.round((apTotal / cogs365Mxn) * 365) : null;

  return {
    arTotalMxn: arTotal,
    arOverdueMxn: arOverdueTotal,
    arCompaniesCount: arRows.length,
    arOverdueCount,
    apTotalMxn: apTotal,
    apOverdueMxn: 0,
    apCompaniesCount: apRows.length,
    apOverdueCount: 0,
    netoMxn: arTotal - apTotal,
    topAr,
    topAp,
    dsoDays,
    dpoDays,
    asOfDate: cf?.refreshed_at ?? null,
  };
}

export const getWorkingCapital = unstable_cache(
  _getWorkingCapitalRaw,
  ["sp13-finanzas-working-capital-v2"],
  { revalidate: 60, tags: ["finanzas"] }
);

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
