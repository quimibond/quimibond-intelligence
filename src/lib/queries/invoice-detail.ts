import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

/**
 * Single-invoice detail for the InvoiceDetail drill-down.
 * Used by EvidenceChip drill-downs in evidence packs and insights.
 */
export interface InvoiceDetail {
  id: number;
  name: string | null;
  move_type: string | null;
  company_id: number | null;
  company_name: string | null;
  amount_total_mxn: number;
  amount_residual_mxn: number;
  amount_untaxed_mxn: number;
  currency: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  days_overdue: number | null;
  days_to_pay: number | null;
  payment_state: string | null;
  payment_status: string | null;
  state: string | null;
  salesperson_name: string | null;
  cfdi_uuid: string | null;
  cfdi_sat_state: string | null;
  ref: string | null;
  lines: Array<{
    product_ref: string | null;
    product_name: string | null;
    quantity: number;
    price_unit: number;
    discount: number;
    price_subtotal_mxn: number;
  }>;
}

/**
 * Busca la factura por nombre canónico (e.g. "INV/2026/02/0144") o por id.
 */
export async function getInvoiceByName(
  reference: string
): Promise<InvoiceDetail | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_invoices")
    .select(
      "id, name, move_type, company_id, amount_total_mxn, amount_residual_mxn, amount_untaxed_mxn, currency, invoice_date, due_date, payment_date, days_overdue, days_to_pay, payment_state, payment_status, state, salesperson_name, cfdi_uuid, cfdi_sat_state, ref, companies:company_id(name)"
    )
    .eq("name", reference)
    .maybeSingle();
  if (!data) return null;

  const base = data as unknown as {
    id: number;
    name: string | null;
    move_type: string | null;
    company_id: number | null;
    amount_total_mxn: number | null;
    amount_residual_mxn: number | null;
    amount_untaxed_mxn: number | null;
    currency: string | null;
    invoice_date: string | null;
    due_date: string | null;
    payment_date: string | null;
    days_overdue: number | null;
    days_to_pay: number | null;
    payment_state: string | null;
    payment_status: string | null;
    state: string | null;
    salesperson_name: string | null;
    cfdi_uuid: string | null;
    cfdi_sat_state: string | null;
    ref: string | null;
    companies: unknown;
  };

  // Fetch lines
  const { data: linesData } = await sb
    .from("odoo_invoice_lines")
    .select(
      "product_ref, product_name, quantity, price_unit, discount, price_subtotal_mxn"
    )
    .eq("odoo_move_id", base.id);

  const lines = ((linesData ?? []) as Array<{
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

  return {
    id: base.id,
    name: base.name,
    move_type: base.move_type,
    company_id: base.company_id,
    company_name: joinedCompanyName(base.companies),
    amount_total_mxn: Number(base.amount_total_mxn) || 0,
    amount_residual_mxn: Number(base.amount_residual_mxn) || 0,
    amount_untaxed_mxn: Number(base.amount_untaxed_mxn) || 0,
    currency: base.currency,
    invoice_date: base.invoice_date,
    due_date: base.due_date,
    payment_date: base.payment_date,
    days_overdue: base.days_overdue,
    days_to_pay: base.days_to_pay,
    payment_state: base.payment_state,
    payment_status: base.payment_status,
    state: base.state,
    salesperson_name: base.salesperson_name,
    cfdi_uuid: base.cfdi_uuid,
    cfdi_sat_state: base.cfdi_sat_state,
    ref: base.ref,
    lines,
  };
}
