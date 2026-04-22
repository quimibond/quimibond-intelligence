import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Payments queries — reads from canonical_payments (SP2/SP3 layer).
 *
 * Schema drift vs plan:
 *   - PK is `canonical_id` (not `id`)
 *   - company FK is `counterparty_canonical_company_id` (not `canonical_company_id`)
 *   - date column is `payment_date_resolved` (not `payment_date`)
 *   - amount column is `amount_mxn_resolved` (not `amount_mxn`)
 *   - `source` field does not exist; `sources_present` / `has_odoo_record` / `has_sat_record` exist
 *   - `payment_method_odoo` is the method column (not `method`)
 *   - `direction` replaces `payment_type` (values: 'inbound' | 'outbound')
 *
 * Legacy tables removed: odoo_account_payments
 *
 * Back-compat aliases kept in CompanyPaymentRow so consumer pages
 * (PagosTab etc.) continue to compile pending their own rewire tasks.
 */

export interface CompanyPaymentRow {
  // Canonical fields
  canonical_id: string;
  odoo_payment_id: number | null;
  direction: string | null;
  amount_mxn_resolved: number | null;
  currency_odoo: string | null;
  payment_date_resolved: string | null;
  payment_method_odoo: string | null;
  journal_name: string | null;
  is_reconciled: boolean | null;
  has_odoo_record: boolean | null;
  has_sat_record: boolean | null;
  estado_sat: string | null;
  sources_present: string[] | null;

  // Back-compat aliases (for PagosTab and other consumers pre-rewire)
  id: string; // alias for canonical_id
  payment_type: string | null; // alias for direction
  payment_date: string | null; // alias for payment_date_resolved
  amount_mxn: number | null; // alias for amount_mxn_resolved
  amount: number | null; // alias for amount_mxn_resolved
  currency: string | null; // alias for currency_odoo
  state: string | null; // derived: 'paid' when is_reconciled
  name: string | null; // derived from odoo_payment_id or payment_method_odoo
}

export async function listCompanyPayments(
  canonical_company_id: number,
  opts: { limit?: number } = {},
): Promise<CompanyPaymentRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_payments")
    .select(
      "canonical_id, odoo_payment_id, direction, amount_mxn_resolved, currency_odoo, payment_date_resolved, payment_method_odoo, journal_name, is_reconciled, has_odoo_record, has_sat_record, estado_sat, sources_present",
    )
    .eq("counterparty_canonical_company_id", canonical_company_id)
    .order("payment_date_resolved", { ascending: false, nullsFirst: false });

  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;

  return ((data ?? []) as Array<{
    canonical_id: string;
    odoo_payment_id: number | null;
    direction: string | null;
    amount_mxn_resolved: number | null;
    currency_odoo: string | null;
    payment_date_resolved: string | null;
    payment_method_odoo: string | null;
    journal_name: string | null;
    is_reconciled: boolean | null;
    has_odoo_record: boolean | null;
    has_sat_record: boolean | null;
    estado_sat: string | null;
    sources_present: string[] | null;
  }>).map((r) => ({
    // Canonical fields
    canonical_id: r.canonical_id,
    odoo_payment_id: r.odoo_payment_id,
    direction: r.direction,
    amount_mxn_resolved: r.amount_mxn_resolved,
    currency_odoo: r.currency_odoo,
    payment_date_resolved: r.payment_date_resolved,
    payment_method_odoo: r.payment_method_odoo,
    journal_name: r.journal_name,
    is_reconciled: r.is_reconciled,
    has_odoo_record: r.has_odoo_record,
    has_sat_record: r.has_sat_record,
    estado_sat: r.estado_sat,
    sources_present: r.sources_present,

    // Back-compat aliases
    id: r.canonical_id,
    payment_type: r.direction,
    payment_date: r.payment_date_resolved,
    amount_mxn: r.amount_mxn_resolved,
    amount: r.amount_mxn_resolved,
    currency: r.currency_odoo,
    state: r.is_reconciled ? "paid" : "not_paid",
    name: r.odoo_payment_id
      ? `PAY-${r.odoo_payment_id}`
      : (r.payment_method_odoo ?? null),
  }));
}

// Back-compat: getCompanyPayments was used by PagosTab with an Odoo company_id.
// After SP3 MDM backfill, counterparty_canonical_company_id is the canonical ID.
// Callers should be migrated to pass canonical_company_id; body now reads canonical_payments.
export async function getCompanyPayments(
  canonical_company_id: number,
  limit = 100,
): Promise<CompanyPaymentRow[]> {
  return listCompanyPayments(canonical_company_id, { limit });
}

export function classifyPaymentState(
  odoo_payment_state: string | null,
): "paid" | "partial" | "unpaid" | "unknown" {
  switch (odoo_payment_state) {
    case "paid":
      return "paid";
    case "in_payment":
    case "partial":
      return "partial";
    case "not_paid":
      return "unpaid";
    default:
      return "unknown";
  }
}
