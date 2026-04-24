import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F4 — Working capital.
 *
 * IMPORTANT — DATA QUALITY NOTE (2026-04-24):
 * `gold_cashflow.total_receivable_mxn` and `canonical_companies.total_receivable_mxn`
 * both derive from `canonical_invoices.amount_residual_mxn_resolved`, which has
 * a double-FX bug for USD invoices: the resolved column multiplies the residual
 * by the FX rate twice, so $21,561 USD becomes $6.4M MXN instead of $372k.
 * Gold aggregate reports $259M AR when the real number is $25M.
 *
 * Until the silver layer fix lands, this helper ignores the corrupted
 * aggregates and iterates `canonical_invoices.amount_residual_mxn_odoo` — that
 * column is the live Odoo residual translated with a single FX pass (validated
 * against sample USD + MXN invoices, matches /cobranza exactly).
 *
 * Sources:
 * - canonical_invoices (authoritative open AR/AP per invoice)
 * - canonical_companies (display_name lookup only)
 * - canonical_invoices 365d totals → DSO / DPO denominators
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
  arInvoiceCount: number;
  arOverdueCount: number;
  arCompaniesCount: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  apInvoiceCount: number;
  apOverdueCount: number;
  apCompaniesCount: number;
  netoMxn: number;
  topAr: WorkingCapitalContributor[];
  topAp: WorkingCapitalContributor[];
  dsoDays: number | null;
  dpoDays: number | null;
}

type OpenInvoice = {
  emisor_canonical_company_id: number | null;
  receptor_canonical_company_id: number | null;
  amount_residual_mxn_odoo: number | null;
  due_date_odoo: string | null;
};

async function _getWorkingCapitalRaw(): Promise<WorkingCapitalSummary> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const [arOpen, apOpen, companiesLookup, revenue365, cogs365] =
    await Promise.all([
      sb
        .from("canonical_invoices")
        .select(
          "receptor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo"
        )
        .eq("direction", "issued")
        .gt("amount_residual_mxn_odoo", 0),
      sb
        .from("canonical_invoices")
        .select(
          "emisor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo"
        )
        .eq("direction", "received")
        .gt("amount_residual_mxn_odoo", 0),
      sb.from("canonical_companies").select("id, display_name"),
      sb
        .from("canonical_invoices")
        .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
        .eq("direction", "issued")
        .gte("invoice_date", daysAgoIso(365)),
      sb
        .from("canonical_invoices")
        .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
        .eq("direction", "received")
        .gte("invoice_date", daysAgoIso(365)),
    ]);

  const arRows = (arOpen.data ?? []) as OpenInvoice[];
  const apRows = (apOpen.data ?? []) as OpenInvoice[];

  type CompanyLookup = { id: number; display_name: string | null };
  const companyNames = new Map<number, string>();
  for (const c of (companiesLookup.data ?? []) as CompanyLookup[]) {
    companyNames.set(c.id, c.display_name ?? `#${c.id}`);
  }

  // AR: totals + per-company aggregation
  const ar = aggregate(
    arRows,
    (r) => r.receptor_canonical_company_id,
    today,
    companyNames
  );
  const ap = aggregate(
    apRows,
    (r) => r.emisor_canonical_company_id,
    today,
    companyNames
  );

  // DSO/DPO denominators — use amount_total_mxn_odoo (same single-FX guarantee)
  type InvoiceTotal = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const revenue365Mxn = ((revenue365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + (Number(r.amount_total_mxn_odoo ?? r.amount_total_mxn_resolved) || 0),
    0
  );
  const cogs365Mxn = ((cogs365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + (Number(r.amount_total_mxn_odoo ?? r.amount_total_mxn_resolved) || 0),
    0
  );
  const dsoDays = revenue365Mxn > 0 ? Math.round((ar.total / revenue365Mxn) * 365) : null;
  const dpoDays = cogs365Mxn > 0 ? Math.round((ap.total / cogs365Mxn) * 365) : null;

  return {
    arTotalMxn: ar.total,
    arOverdueMxn: ar.overdue,
    arInvoiceCount: arRows.length,
    arOverdueCount: ar.overdueCount,
    arCompaniesCount: ar.topList.length + ar.tailCount,
    apTotalMxn: ap.total,
    apOverdueMxn: ap.overdue,
    apInvoiceCount: apRows.length,
    apOverdueCount: ap.overdueCount,
    apCompaniesCount: ap.topList.length + ap.tailCount,
    netoMxn: ar.total - ap.total,
    topAr: ar.topList,
    topAp: ap.topList,
    dsoDays,
    dpoDays,
  };
}

type AggregateResult = {
  total: number;
  overdue: number;
  overdueCount: number;
  topList: WorkingCapitalContributor[];
  tailCount: number;
};

function aggregate(
  rows: OpenInvoice[],
  pickCompany: (r: OpenInvoice) => number | null,
  today: string,
  companyNames: Map<number, string>
): AggregateResult {
  let total = 0;
  let overdueTotal = 0;
  let overdueCount = 0;
  const byCompany = new Map<number, WorkingCapitalContributor>();

  for (const r of rows) {
    const amt = Number(r.amount_residual_mxn_odoo) || 0;
    total += amt;
    const isOverdue = r.due_date_odoo != null && r.due_date_odoo < today;
    if (isOverdue) {
      overdueTotal += amt;
      overdueCount++;
    }
    const cid = pickCompany(r);
    if (cid == null) continue;
    const existing = byCompany.get(cid) ?? {
      companyId: cid,
      companyName: companyNames.get(cid) ?? `#${cid}`,
      totalMxn: 0,
      overdueMxn: 0,
      invoiceCount: 0,
      overdueCount: 0,
    };
    existing.totalMxn += amt;
    existing.invoiceCount++;
    if (isOverdue) {
      existing.overdueMxn += amt;
      existing.overdueCount++;
    }
    byCompany.set(cid, existing);
  }

  const sorted = [...byCompany.values()].sort((a, b) => b.totalMxn - a.totalMxn);
  return {
    total,
    overdue: overdueTotal,
    overdueCount,
    topList: sorted.slice(0, 10),
    tailCount: Math.max(sorted.length - 10, 0),
  };
}

export const getWorkingCapital = unstable_cache(
  _getWorkingCapitalRaw,
  ["sp13-finanzas-working-capital-v3-fx-fix"],
  { revalidate: 60, tags: ["finanzas"] }
);

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
