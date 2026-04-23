import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";
import { paginationRange, type TableParams } from "../../_shared/table-params";

// Full paged list of open AR invoices (C7).
// Shown as "the long table" at the bottom of /cobranza.

export interface OpenInvoiceRow {
  canonicalId: string;
  odooInvoiceId: number | null;
  folio: string | null;
  satUuid: string | null;
  companyId: number | null;
  companyName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number | null;
  amountTotalMxn: number;
  amountResidualMxn: number;
  estadoSat: string | null;
  paymentState: string | null;
}

export interface OpenInvoicesPage {
  rows: OpenInvoiceRow[];
  total: number;
}

const SORT_MAP: Record<string, string> = {
  residual: "amount_residual_mxn_odoo",
  total: "amount_total_mxn_odoo",
  due: "due_date_odoo",
  invoice: "invoice_date",
  folio: "odoo_name",
};

export type OpenInvoicesParams = TableParams & {
  bucket?: string[]; // "1-30" | "31-60" | "61-90" | "90+"
  estadoSat?: string[];
  companyId?: number;
};

export async function getOpenInvoicesPage(
  params: OpenInvoicesParams
): Promise<OpenInvoicesPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol = (params.sort && SORT_MAP[params.sort]) ?? "amount_residual_mxn_odoo";
  const ascending = params.sortDir === "asc";
  const today = new Date().toISOString().slice(0, 10);

  let query = sb
    .from("canonical_invoices")
    .select(
      "canonical_id, odoo_invoice_id, odoo_name, odoo_ref, sat_uuid, receptor_canonical_company_id, amount_total_mxn_resolved, amount_total_mxn_odoo, amount_residual_mxn_resolved, amount_residual_mxn_odoo, invoice_date, due_date_resolved, due_date_odoo, estado_sat, payment_state_odoo",
      { count: "exact" }
    )
    .eq("direction", "issued")
    .neq("estado_sat", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .or("amount_residual_mxn_resolved.gt.0.01,amount_residual_mxn_odoo.gt.0.01")
    .not("receptor_canonical_company_id", "in", pgInList(selfIds));

  if (params.q) {
    query = query.or(
      `odoo_name.ilike.%${params.q}%,sat_uuid.ilike.%${params.q}%,odoo_ref.ilike.%${params.q}%`
    );
  }
  if (params.estadoSat && params.estadoSat.length > 0) {
    query = query.in("estado_sat", params.estadoSat);
  }
  if (typeof params.companyId === "number") {
    query = query.eq("receptor_canonical_company_id", params.companyId);
  }
  if (params.bucket && params.bucket.length > 0) {
    const now = new Date();
    const orParts: string[] = [];
    for (const b of params.bucket) {
      if (b === "1-30") {
        const d30 = new Date(now.getTime() - 30 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`and(due_date_odoo.gte.${d30},due_date_odoo.lt.${today})`);
      } else if (b === "31-60") {
        const d31 = new Date(now.getTime() - 31 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d60 = new Date(now.getTime() - 60 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`and(due_date_odoo.gte.${d60},due_date_odoo.lt.${d31})`);
      } else if (b === "61-90") {
        const d61 = new Date(now.getTime() - 61 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d90 = new Date(now.getTime() - 90 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`and(due_date_odoo.gte.${d90},due_date_odoo.lt.${d61})`);
      } else if (b === "90+") {
        const d90 = new Date(now.getTime() - 90 * 86400000)
          .toISOString()
          .slice(0, 10);
        orParts.push(`due_date_odoo.lt.${d90}`);
      }
    }
    if (orParts.length > 0) query = query.or(orParts.join(","));
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  type CanRow = {
    canonical_id: string | null;
    odoo_invoice_id: number | null;
    odoo_name: string | null;
    odoo_ref: string | null;
    sat_uuid: string | null;
    receptor_canonical_company_id: number | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
    invoice_date: string | null;
    due_date_resolved: string | null;
    due_date_odoo: string | null;
    estado_sat: string | null;
    payment_state_odoo: string | null;
  };

  const raw = (data ?? []) as CanRow[];

  // Join company name batch — canonical_companies.display_name.
  const companyIds = Array.from(
    new Set(
      raw
        .map((r) => r.receptor_canonical_company_id)
        .filter((id): id is number => id != null)
    )
  );
  const nameByCompany = new Map<number, string>();
  if (companyIds.length > 0) {
    const { data: compData } = await sb
      .from("canonical_companies")
      .select("id, display_name")
      .in("id", companyIds);
    for (const c of (compData ?? []) as Array<{ id: number | null; display_name: string | null }>) {
      if (c.id == null || !c.display_name) continue;
      nameByCompany.set(c.id, c.display_name);
    }
  }

  const todayMs = Date.now();
  const rows: OpenInvoiceRow[] = raw.map((r) => {
    const due = r.due_date_resolved ?? r.due_date_odoo;
    const daysOverdue = due
      ? Math.max(0, Math.floor((todayMs - new Date(due).getTime()) / 86400000))
      : null;
    return {
      canonicalId: r.canonical_id ?? String(r.odoo_invoice_id ?? ""),
      odooInvoiceId: r.odoo_invoice_id,
      folio: r.odoo_name ?? r.odoo_ref,
      satUuid: r.sat_uuid,
      companyId: r.receptor_canonical_company_id,
      companyName:
        r.receptor_canonical_company_id != null
          ? nameByCompany.get(r.receptor_canonical_company_id) ?? null
          : null,
      invoiceDate: r.invoice_date,
      dueDate: due,
      daysOverdue,
      amountTotalMxn:
        Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0,
      amountResidualMxn:
        Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0,
      estadoSat: r.estado_sat,
      paymentState: r.payment_state_odoo,
    };
  });

  return { rows, total: count ?? rows.length };
}
