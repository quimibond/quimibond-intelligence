import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { toMxn } from "@/lib/formatters";

/**
 * Cobranza queries v2 — usa views canónicas:
 * - `cash_flow_aging` — AR por empresa con buckets (current/1-30/31-60/61-90/90+)
 * - `ar_aging_detail` — AR por factura con aging_bucket pre-computado
 *
 * Como `odoo_invoices.amount_*_mxn` está NULL, sumamos con `toMxn(amount, currency)`.
 */

export interface ArAgingBucket {
  bucket: string; // "1-30" | "31-60" | "61-90" | "91-120" | "120+"
  count: number;
  amount_mxn: number;
}

/**
 * Buckets del AR usando la MV `ar_aging_detail` (una fila por factura vencida).
 * Filtra "current" (no vencido).
 */
export async function getArAging(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("ar_aging_detail")
    .select("aging_bucket, amount_residual, currency, bucket_sort")
    .gt("bucket_sort", 1);

  const rows = (data ?? []) as Array<{
    aging_bucket: string | null;
    amount_residual: number | null;
    currency: string | null;
    bucket_sort: number | null;
  }>;

  const buckets = new Map<
    string,
    { count: number; total: number; sort: number }
  >();
  for (const r of rows) {
    const key = r.aging_bucket ?? "—";
    const b = buckets.get(key) ?? {
      count: 0,
      total: 0,
      sort: Number(r.bucket_sort) || 99,
    };
    b.count += 1;
    b.total += toMxn(r.amount_residual, r.currency);
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .map(([bucket, v]) => ({
      bucket,
      count: v.count,
      amount_mxn: v.total,
      _sort: v.sort,
    }))
    .sort((a, b) => a._sort - b._sort)
    .map(({ bucket, count, amount_mxn }) => ({ bucket, count, amount_mxn }));
}

/**
 * Empresas con cartera vencida (view: cash_flow_aging).
 * Ya está pre-agregada por empresa con buckets 1-30, 31-60, 61-90, 90+.
 */
export interface CompanyAgingRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  current_amount: number;
  overdue_1_30: number;
  overdue_31_60: number;
  overdue_61_90: number;
  overdue_90plus: number;
  total_receivable: number;
  total_revenue: number;
}

export async function getCompanyAging(
  limit = 50
): Promise<CompanyAgingRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cash_flow_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue"
    )
    .gt("total_receivable", 0)
    .order("total_receivable", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<CompanyAgingRow>>).map((r) => ({
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? null,
    tier: r.tier ?? null,
    current_amount: Number(r.current_amount) || 0,
    overdue_1_30: Number(r.overdue_1_30) || 0,
    overdue_31_60: Number(r.overdue_31_60) || 0,
    overdue_61_90: Number(r.overdue_61_90) || 0,
    overdue_90plus: Number(r.overdue_90plus) || 0,
    total_receivable: Number(r.total_receivable) || 0,
    total_revenue: Number(r.total_revenue) || 0,
  }));
}

export interface OverdueInvoice {
  id: number;
  name: string | null;
  company_id: number | null;
  company_name: string | null;
  amount_total_mxn: number;
  amount_residual_mxn: number;
  currency: string | null;
  days_overdue: number | null;
  aging_bucket: string | null;
  due_date: string | null;
  invoice_date: string | null;
  payment_state: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Payment predictions — clientes con patrón anormal de pago
// ──────────────────────────────────────────────────────────────────────────
export interface PaymentPredictionRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  payment_risk: string;
  payment_trend: string | null;
  avg_days_to_pay: number | null;
  median_days_to_pay: number | null;
  max_days_overdue: number | null;
  total_pending: number;
  pending_count: number;
  predicted_payment_date: string | null;
}

/**
 * Devuelve solo los clientes con patrón anormal de pago (no NORMAL).
 * `payment_risk` viene como texto largo: "CRITICO: excede maximo historico", etc.
 */
export async function getPaymentPredictions(
  limit = 30
): Promise<PaymentPredictionRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("payment_predictions")
    .select(
      "company_id, company_name, tier, payment_risk, payment_trend, avg_days_to_pay, median_days_to_pay, max_days_overdue, total_pending, pending_count, predicted_payment_date"
    )
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .order("total_pending", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<PaymentPredictionRow>>).map((r) => ({
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? null,
    tier: r.tier ?? null,
    payment_risk: r.payment_risk ?? "—",
    payment_trend: r.payment_trend ?? null,
    avg_days_to_pay:
      r.avg_days_to_pay != null ? Number(r.avg_days_to_pay) : null,
    median_days_to_pay:
      r.median_days_to_pay != null ? Number(r.median_days_to_pay) : null,
    max_days_overdue:
      r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    total_pending: Number(r.total_pending) || 0,
    pending_count: Number(r.pending_count) || 0,
    predicted_payment_date: r.predicted_payment_date ?? null,
  }));
}

/**
 * Conteo y suma de los clientes con riesgo crítico/alto/medio.
 */
export async function getPaymentRiskKpis(): Promise<{
  abnormalCount: number;
  abnormalPending: number;
  criticalCount: number;
  criticalPending: number;
}> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("payment_predictions")
    .select("payment_risk, total_pending")
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%");
  const rows = (data ?? []) as Array<{
    payment_risk: string | null;
    total_pending: number | null;
  }>;
  const abnormalPending = rows.reduce(
    (a, r) => a + (Number(r.total_pending) || 0),
    0
  );
  const critical = rows.filter((r) =>
    (r.payment_risk ?? "").toUpperCase().startsWith("CRITICO")
  );
  const criticalPending = critical.reduce(
    (a, r) => a + (Number(r.total_pending) || 0),
    0
  );
  return {
    abnormalCount: rows.length,
    abnormalPending,
    criticalCount: critical.length,
    criticalPending,
  };
}

/**
 * Facturas vencidas (view: ar_aging_detail).
 * Una fila por factura, con aging_bucket pre-computado.
 */
export async function getOverdueInvoices(
  limit = 50
): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("ar_aging_detail")
    .select(
      "invoice_id, invoice_name, company_id, company_name, amount_total, amount_residual, currency, days_overdue, aging_bucket, due_date, invoice_date, payment_state, bucket_sort"
    )
    .gt("bucket_sort", 1)
    .order("amount_residual", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Array<{
    invoice_id: number;
    invoice_name: string | null;
    company_id: number | null;
    company_name: string | null;
    amount_total: number | null;
    amount_residual: number | null;
    currency: string | null;
    days_overdue: number | null;
    aging_bucket: string | null;
    due_date: string | null;
    invoice_date: string | null;
    payment_state: string | null;
  }>).map((r) => ({
    id: r.invoice_id,
    name: r.invoice_name,
    company_id: r.company_id,
    company_name: r.company_name,
    amount_total_mxn: toMxn(r.amount_total, r.currency),
    amount_residual_mxn: toMxn(r.amount_residual, r.currency),
    currency: r.currency,
    days_overdue: r.days_overdue,
    aging_bucket: r.aging_bucket,
    due_date: r.due_date,
    invoice_date: r.invoice_date,
    payment_state: r.payment_state,
  }));
}
