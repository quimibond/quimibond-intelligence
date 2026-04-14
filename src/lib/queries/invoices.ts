import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, joinedCompanyName, pgInList } from "./_helpers";

/**
 * Cobranza queries v2 — usa SIEMPRE columnas `_mxn` per spec.
 * - `odoo_invoices.amount_total_mxn` / `amount_residual_mxn` → para sumas
 * - `cash_flow_aging` (view) — buckets por empresa (ya normalizada)
 * - `payment_predictions` (MV) — riesgo anormal de pago
 */

// ──────────────────────────────────────────────────────────────────────────
// AR aging buckets (calculado de odoo_invoices con _mxn)
// ──────────────────────────────────────────────────────────────────────────
export interface ArAgingBucket {
  bucket: string; // "1-30" | "31-60" | "61-90" | "91-120" | "120+"
  count: number;
  amount_mxn: number;
}

const BUCKET_DEFS: Array<{
  label: string;
  min: number;
  max: number | null;
  sort: number;
}> = [
  { label: "1-30", min: 1, max: 30, sort: 1 },
  { label: "31-60", min: 31, max: 60, sort: 2 },
  { label: "61-90", min: 61, max: 90, sort: 3 },
  { label: "91-120", min: 91, max: 120, sort: 4 },
  { label: "120+", min: 121, max: null, sort: 5 },
];

export async function getArAging(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("odoo_invoices")
    .select("amount_residual_mxn, days_overdue")
    .eq("move_type", "out_invoice")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds));

  const rows = (data ?? []) as Array<{
    amount_residual_mxn: number | null;
    days_overdue: number | null;
  }>;

  return BUCKET_DEFS.map((b) => {
    const inBucket = rows.filter((r) => {
      const d = Number(r.days_overdue) || 0;
      if (d < b.min) return false;
      if (b.max != null && d > b.max) return false;
      return true;
    });
    return {
      bucket: b.label,
      count: inBucket.length,
      amount_mxn: inBucket.reduce(
        (acc, r) => acc + (Number(r.amount_residual_mxn) || 0),
        0
      ),
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Empresas con cartera vencida (view: cash_flow_aging — ya normalizada)
// ──────────────────────────────────────────────────────────────────────────
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
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("cash_flow_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue"
    )
    .gt("total_receivable", 0)
    .not("company_id", "in", pgInList(selfIds))
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
  due_date: string | null;
  invoice_date: string | null;
  payment_state: string | null;
  salesperson_name: string | null;
}

/**
 * Facturas vencidas — query directo a odoo_invoices con _mxn.
 */
export async function getOverdueInvoices(
  limit = 50
): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("odoo_invoices")
    .select(
      "id, name, company_id, amount_total_mxn, amount_residual_mxn, currency, days_overdue, due_date, invoice_date, payment_state, salesperson_name, companies:company_id(name)"
    )
    .eq("move_type", "out_invoice")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds))
    .order("amount_residual_mxn", { ascending: false, nullsFirst: false })
    .limit(limit);

  type Raw = Omit<OverdueInvoice, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    name: row.name,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    amount_total_mxn: Number(row.amount_total_mxn) || 0,
    amount_residual_mxn: Number(row.amount_residual_mxn) || 0,
    currency: row.currency,
    days_overdue: row.days_overdue,
    due_date: row.due_date,
    invoice_date: row.invoice_date,
    payment_state: row.payment_state,
    salesperson_name: row.salesperson_name,
  }));
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

export async function getPaymentPredictions(
  limit = 30
): Promise<PaymentPredictionRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("payment_predictions")
    .select(
      "company_id, company_name, tier, payment_risk, payment_trend, avg_days_to_pay, median_days_to_pay, max_days_overdue, total_pending, pending_count, predicted_payment_date"
    )
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds))
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

export async function getPaymentRiskKpis(): Promise<{
  abnormalCount: number;
  abnormalPending: number;
  criticalCount: number;
  criticalPending: number;
}> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("payment_predictions")
    .select("payment_risk, total_pending")
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds));
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
