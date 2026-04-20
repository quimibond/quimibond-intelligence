import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { type YearValue, yearBounds } from "../_shared/year-filter";
import { endOfDay, paginationRange, type TableParams } from "../_shared/table-params";

/**
 * Pagos queries — usa payments_unified (complementos SAT reconciliados con Odoo)
 * y reconciliation_issues para complementos faltantes.
 *
 * Columnas clave de payments_unified:
 *   canonical_payment_id, fecha_pago, monto, direction, match_status,
 *   forma_pago_p, moneda_p, journal_name, company_id, estado_sat,
 *   odoo_payment_id, uuid_complemento, odoo_ref, odoo_amount, odoo_date,
 *   payment_method, is_reconciled, odoo_currency, refreshed_at
 *
 * direction values: "received" (incoming from customers) | "issued" (outgoing to providers)
 */

// ──────────────────────────────────────────────────────────────────────────
// Aging desde company_profile.ar_aging_buckets
// ──────────────────────────────────────────────────────────────────────────

export type AgingKind = "cxc" | "cxp";

export interface AgingBucketResult {
  label: "0-30" | "31-60" | "61-90" | "90+";
  amount: number;
}

export async function getAgingSummary(kind: AgingKind): Promise<AgingBucketResult[]> {
  const sb = getServiceClient();
  const filter = kind === "cxc" ? { is_customer: true } : { is_supplier: true };

  const { data, error } = await sb
    .from("company_profile")
    .select("ar_aging_buckets")
    .match(filter);

  if (error) throw new Error(`[getAgingSummary:${kind}] ${error.message}`);

  const totals: Record<string, number> = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  for (const row of data ?? []) {
    const b = (row as Record<string, unknown>).ar_aging_buckets as Record<string, unknown> | null;
    if (!b) continue;
    totals["0-30"] += Number(b.bucket_0_30 ?? 0);
    totals["31-60"] += Number(b.bucket_31_60 ?? 0);
    totals["61-90"] += Number(b.bucket_61_90 ?? 0);
    totals["90+"] += Number(b.bucket_90_plus ?? 0);
  }

  return [
    { label: "0-30", amount: totals["0-30"] },
    { label: "31-60", amount: totals["31-60"] },
    { label: "61-90", amount: totals["61-90"] },
    { label: "90+", amount: totals["90+"] },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos de pago
// ──────────────────────────────────────────────────────────────────────────

/** "received" = de clientes / "issued" = a proveedores */
export type PaymentDirection = "received" | "issued";

export interface PaymentRow {
  canonical_payment_id: string;
  uuid_complemento: string | null;
  odoo_payment_id: number | null;
  match_status: string | null;
  direction: string | null;
  fecha_pago: string | null;
  forma_pago_p: string | null;
  moneda_p: string | null;
  monto: number | null;
  journal_name: string | null;
  payment_method: string | null;
  is_reconciled: boolean | null;
  odoo_ref: string | null;
  odoo_amount: number | null;
  odoo_currency: string | null;
  company_id: number | null;
  estado_sat: string | null;
  refreshed_at: string | null;
}

export interface PaymentsPageResult {
  rows: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getPaymentsPage(
  params: TableParams & { direction: PaymentDirection; year?: YearValue }
): Promise<PaymentsPageResult> {
  const sb = getServiceClient();
  const { direction, year } = params;
  const bounds = year ? yearBounds(year) : null;
  const [from, to] = paginationRange(params.page, params.size);

  let q = sb
    .from("payments_unified")
    .select(
      "canonical_payment_id, uuid_complemento, odoo_payment_id, match_status, direction, fecha_pago, forma_pago_p, moneda_p, monto, journal_name, payment_method, is_reconciled, odoo_ref, odoo_amount, odoo_currency, company_id, estado_sat, refreshed_at",
      { count: "exact" }
    )
    .eq("direction", direction);

  if (bounds) {
    q = q
      .gte("fecha_pago", bounds.from.toISOString())
      .lt("fecha_pago", bounds.to.toISOString());
  } else if (params.from && params.to) {
    q = q
      .gte("fecha_pago", params.from)
      .lte("fecha_pago", endOfDay(params.to) ?? params.to);
  }

  q = q.order("fecha_pago", { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new Error(`[getPaymentsPage:${direction}] ${error.message}`);

  return {
    rows: (data ?? []) as PaymentRow[],
    total: count ?? 0,
    page: params.page,
    pageSize: params.size,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Complementos SAT faltantes (reconciliation_issues)
// ──────────────────────────────────────────────────────────────────────────

export interface ComplementoMissingRow {
  issue_id: string;
  issue_type: string | null;
  canonical_id: string | null;
  uuid_sat: string | null;
  odoo_invoice_id: number | null;
  odoo_payment_id: number | null;
  company_id: number | null;
  description: string | null;
  severity: string | null;
  detected_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ComplementosMissingPageResult {
  rows: ComplementoMissingRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getComplementosMissingPage(
  params: TableParams & { year?: YearValue }
): Promise<ComplementosMissingPageResult> {
  const sb = getServiceClient();
  const { year } = params;
  const bounds = year ? yearBounds(year) : null;
  const [from, to] = paginationRange(params.page, params.size);

  let q = sb
    .from("reconciliation_issues")
    .select(
      "issue_id, issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_payment_id, company_id, description, severity, detected_at, resolved_at, metadata",
      { count: "exact" }
    )
    .eq("issue_type", "complemento_missing_payment")
    .is("resolved_at", null);

  if (bounds) {
    // detected_at como proxy de fecha — no hay campo de fecha directa en esta tabla
    q = q
      .gte("detected_at", bounds.from.toISOString())
      .lt("detected_at", bounds.to.toISOString());
  }

  q = q.order("detected_at", { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new Error(`[getComplementosMissingPage] ${error.message}`);

  return {
    rows: (data ?? []) as ComplementoMissingRow[],
    total: count ?? 0,
    page: params.page,
    pageSize: params.size,
  };
}
