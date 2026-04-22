import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { listAllocations } from "./invoices";

/**
 * SP5 Task 11: rewired invoice detail to canonical_invoices.
 * Legacy reads removed: odoo_invoices → canonical_invoices (by canonical_id or odoo_name).
 *
 * SP5-EXCEPTION (1): odoo_invoice_lines for line-item detail —
 * canonical_invoice_lines not shipped in SP4; future SP6.
 *
 * email_cfdi_links is a base table (not in §12 drop list) — unchanged.
 * reconciliation_issues is a base table — unchanged.
 */

// ──────────────────────────────────────────────────────────────────────────
// CFDI email link — unchanged (email_cfdi_links is a base table, not banned)
// ──────────────────────────────────────────────────────────────────────────
export interface CfdiEmailLink {
  id: number;
  email_id: number | null;
  gmail_message_id: string | null;
  account: string | null;
  uuid: string | null;
}

export async function getCfdiLinkByUuid(
  uuid: string
): Promise<CfdiEmailLink | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("email_cfdi_links")
    .select("id, email_id, gmail_message_id, account, uuid")
    .eq("uuid", uuid)
    .maybeSingle();
  return (data as CfdiEmailLink | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// InvoiceDetail — SP5 shape (canonical + back-compat aliases)
// ──────────────────────────────────────────────────────────────────────────
export interface InvoiceDetail {
  // Canonical fields
  canonical_id: string;
  sat_uuid: string | null;
  direction: string | null;
  // Back-compat aliases (legacy consumers used odoo_invoices field names)
  id: number | null; // odoo_invoice_id
  name: string | null; // odoo_name
  move_type: string | null; // move_type_odoo
  company_id: number | null; // receptor_canonical_company_id
  company_name: string | null; // always null; SP6 join canonical_companies
  amount_total_mxn: number;
  amount_residual_mxn: number;
  amount_untaxed_mxn: number; // amount_untaxed_odoo
  currency: string | null; // currency_odoo
  invoice_date: string | null;
  due_date: string | null; // due_date_odoo
  payment_date: string | null; // payment_date_odoo
  days_overdue: number | null; // computed from due_date_odoo
  days_to_pay: number | null; // fiscal_days_to_full_payment
  payment_state: string | null; // payment_state_odoo
  payment_status: string | null; // same as payment_state_odoo
  state: string | null; // state_odoo
  salesperson_name: string | null; // not on canonical; null (SP6)
  cfdi_uuid: string | null; // sat_uuid alias
  cfdi_sat_state: string | null; // estado_sat
  ref: string | null; // odoo_ref
  // Relations
  allocations: Array<Record<string, unknown>>;
  lines: Array<{
    product_ref: string | null;
    product_name: string | null;
    quantity: number;
    price_unit: number;
    discount: number;
    price_subtotal_mxn: number;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────
// fetchInvoiceDetail — look up by canonical_id
// ──────────────────────────────────────────────────────────────────────────
export async function fetchInvoiceDetail(
  canonical_id: string
): Promise<InvoiceDetail | null> {
  const sb = getServiceClient();
  const [{ data: inv, error: invErr }, allocations] = await Promise.all([
    sb
      .from("canonical_invoices")
      .select("*")
      .eq("canonical_id", canonical_id)
      .maybeSingle(),
    listAllocations(canonical_id),
  ]);
  if (invErr) throw invErr;
  if (!inv) return null;

  const r = inv as Record<string, unknown>;
  const odooMoveId = r.odoo_invoice_id ?? null;
  let lines: InvoiceDetail["lines"] = [];

  if (odooMoveId) {
    // SP5-EXCEPTION: odoo_invoice_lines — canonical_invoice_lines not shipped (SP4 scope); future SP6
    const { data: lineData } = await sb
      .from("odoo_invoice_lines") // SP5-EXCEPTION: canonical_invoice_lines not shipped in SP4; future SP6
      .select(
        "product_ref, product_name, quantity, price_unit, discount, price_subtotal_mxn"
      )
      .eq("odoo_move_id", odooMoveId);

    lines = ((lineData ?? []) as Array<{
      product_ref: string | null;
      product_name: string | null;
      quantity: number | null;
      price_unit: number | null;
      discount: number | null;
      price_subtotal_mxn: number | null;
    }>).map((l) => ({
      product_ref: l.product_ref,
      product_name: l.product_name,
      quantity: Number(l.quantity) || 0,
      price_unit: Number(l.price_unit) || 0,
      discount: Number(l.discount) || 0,
      price_subtotal_mxn: Number(l.price_subtotal_mxn) || 0,
    }));
  }

  const dueDate = (r.due_date_odoo as string | null) ?? null;
  const daysOverdue = dueDate
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
      )
    : null;

  return {
    canonical_id: r.canonical_id as string,
    sat_uuid: (r.sat_uuid as string | null) ?? null,
    direction: (r.direction as string | null) ?? null,
    id: r.odoo_invoice_id != null ? Number(r.odoo_invoice_id) : null,
    name: (r.odoo_name as string | null) ?? null,
    move_type: (r.move_type_odoo as string | null) ?? null,
    company_id:
      r.receptor_canonical_company_id != null
        ? Number(r.receptor_canonical_company_id)
        : null,
    company_name: null, // SP6: join canonical_companies
    amount_total_mxn:
      Number(
        (r.amount_total_mxn_resolved as number | null) ??
          (r.amount_total_mxn_odoo as number | null)
      ) || 0,
    amount_residual_mxn:
      Number(r.amount_residual_mxn_odoo as number | null) || 0,
    amount_untaxed_mxn:
      Number(r.amount_untaxed_odoo as number | null) || 0,
    currency: (r.currency_odoo as string | null) ?? null,
    invoice_date: (r.invoice_date as string | null) ?? null,
    due_date: dueDate,
    payment_date: (r.payment_date_odoo as string | null) ?? null,
    days_overdue: daysOverdue,
    days_to_pay:
      r.fiscal_days_to_full_payment != null
        ? Number(r.fiscal_days_to_full_payment)
        : null,
    payment_state: (r.payment_state_odoo as string | null) ?? null,
    payment_status: (r.payment_state_odoo as string | null) ?? null,
    state: (r.state_odoo as string | null) ?? null,
    salesperson_name: null, // SP6: join canonical_contacts via salesperson_contact_id
    cfdi_uuid: (r.sat_uuid as string | null) ?? null,
    cfdi_sat_state: (r.estado_sat as string | null) ?? null,
    ref: (r.odoo_ref as string | null) ?? null,
    allocations,
    lines,
  };
}

export const getInvoiceDetail = fetchInvoiceDetail;

// ──────────────────────────────────────────────────────────────────────────
// getInvoiceByName — look up by odoo_name (e.g. "INV/2026/02/0144")
// SP5: queries canonical_invoices by odoo_name field.
// ──────────────────────────────────────────────────────────────────────────
export async function getInvoiceByName(
  reference: string
): Promise<InvoiceDetail | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select("*")
    .eq("odoo_name", reference)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Delegate to fetchInvoiceDetail for full shape
  return fetchInvoiceDetail((data as Record<string, unknown>).canonical_id as string);
}
