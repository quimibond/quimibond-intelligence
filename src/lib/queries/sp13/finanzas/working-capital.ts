import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F4 — Working capital:
 *  AR abierto + AR vencido + AP abierto + AP vencido + neto.
 *  Top-10 contribuidores cada lado (empresa + monto + overdue).
 *
 * Totals deben cuadrar con /cobranza (AR) y /compras (AP).
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
  arInvoiceCount: number;
  arOverdueCount: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  apInvoiceCount: number;
  apOverdueCount: number;
  netoMxn: number;
  topAr: WorkingCapitalContributor[];
  topAp: WorkingCapitalContributor[];
  dsoDays: number | null;
  dpoDays: number | null;
}

type OpenInvoice = {
  emisor_canonical_company_id: number | null;
  receptor_canonical_company_id: number | null;
  amount_residual_mxn_resolved: number | null;
  amount_residual_mxn_odoo: number | null;
  due_date_resolved: string | null;
  due_date_odoo: string | null;
};

function residual(r: OpenInvoice): number {
  return (
    Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0
  );
}

function dueDate(r: OpenInvoice): string | null {
  return r.due_date_resolved ?? r.due_date_odoo ?? null;
}

async function _getWorkingCapitalRaw(): Promise<WorkingCapitalSummary> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const [arOpen, apOpen, companiesLookup, revenue365, cogs365] = await Promise.all([
    sb
      .from("canonical_invoices")
      .select(
        "receptor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo"
      )
      .eq("direction", "issued")
      .neq("estado_sat", "cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"),
    sb
      .from("canonical_invoices")
      .select(
        "emisor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo"
      )
      .eq("direction", "received")
      .neq("estado_sat", "cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"),
    sb.from("canonical_companies").select("id, display_name"),
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
      .eq("direction", "issued")
      .neq("estado_sat", "cancelado")
      .gte("invoice_date", daysAgoIso(365)),
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
      .eq("direction", "received")
      .neq("estado_sat", "cancelado")
      .gte("invoice_date", daysAgoIso(365)),
  ]);

  const arRows = (arOpen.data ?? []) as OpenInvoice[];
  const apRows = (apOpen.data ?? []) as OpenInvoice[];

  const companies = new Map<number, string>();
  type CompanyRow = { id: number; display_name: string | null };
  for (const c of (companiesLookup.data ?? []) as CompanyRow[]) {
    companies.set(c.id, c.display_name ?? `#${c.id}`);
  }

  // AR totals
  let arTotal = 0;
  let arOverdueTotal = 0;
  let arOverdueCount = 0;
  const arByCompany = new Map<number, WorkingCapitalContributor>();
  for (const r of arRows) {
    const amt = residual(r);
    arTotal += amt;
    const due = dueDate(r);
    const isOverdue = due != null && due < today;
    if (isOverdue) {
      arOverdueTotal += amt;
      arOverdueCount++;
    }
    const cid = r.receptor_canonical_company_id;
    if (cid != null) {
      const existing = arByCompany.get(cid) ?? {
        companyId: cid,
        companyName: companies.get(cid) ?? `#${cid}`,
        totalMxn: 0,
        overdueMxn: 0,
        invoiceCount: 0,
      };
      existing.totalMxn += amt;
      if (isOverdue) existing.overdueMxn += amt;
      existing.invoiceCount++;
      arByCompany.set(cid, existing);
    }
  }

  // AP totals
  let apTotal = 0;
  let apOverdueTotal = 0;
  let apOverdueCount = 0;
  const apByCompany = new Map<number, WorkingCapitalContributor>();
  for (const r of apRows) {
    const amt = residual(r);
    apTotal += amt;
    const due = dueDate(r);
    const isOverdue = due != null && due < today;
    if (isOverdue) {
      apOverdueTotal += amt;
      apOverdueCount++;
    }
    const cid = r.emisor_canonical_company_id;
    if (cid != null) {
      const existing = apByCompany.get(cid) ?? {
        companyId: cid,
        companyName: companies.get(cid) ?? `#${cid}`,
        totalMxn: 0,
        overdueMxn: 0,
        invoiceCount: 0,
      };
      existing.totalMxn += amt;
      if (isOverdue) existing.overdueMxn += amt;
      existing.invoiceCount++;
      apByCompany.set(cid, existing);
    }
  }

  const topAr = [...arByCompany.values()]
    .sort((a, b) => b.totalMxn - a.totalMxn)
    .slice(0, 10);
  const topAp = [...apByCompany.values()]
    .sort((a, b) => b.totalMxn - a.totalMxn)
    .slice(0, 10);

  // DSO/DPO approximations using 365d rolling revenue/COGS
  type InvoiceTotal = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const revenue365Mxn = ((revenue365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );
  const cogs365Mxn = ((cogs365.data ?? []) as InvoiceTotal[]).reduce(
    (s, r) => s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );
  const dsoDays =
    revenue365Mxn > 0 ? Math.round((arTotal / revenue365Mxn) * 365) : null;
  const dpoDays =
    cogs365Mxn > 0 ? Math.round((apTotal / cogs365Mxn) * 365) : null;

  return {
    arTotalMxn: arTotal,
    arOverdueMxn: arOverdueTotal,
    arInvoiceCount: arRows.length,
    arOverdueCount,
    apTotalMxn: apTotal,
    apOverdueMxn: apOverdueTotal,
    apInvoiceCount: apRows.length,
    apOverdueCount,
    netoMxn: arTotal - apTotal,
    topAr,
    topAp,
    dsoDays,
    dpoDays,
  };
}

export const getWorkingCapital = unstable_cache(
  _getWorkingCapitalRaw,
  ["sp13-finanzas-working-capital"],
  { revalidate: 60, tags: ["finanzas"] }
);

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
