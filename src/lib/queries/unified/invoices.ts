import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../_shared/_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * Cobranza queries v2 — usa SIEMPRE columnas `_mxn` per spec.
 * - `invoices_unified` — fuente canónica (Fase 1 migración)
 * - `cash_flow_aging` (view) — buckets por empresa (ya normalizada)
 * - `payment_predictions` (MV) — riesgo anormal de pago
 */

// Common unified filter: direction=issued + computable match_status + no cancelado
const UNIFIED_MATCH_STATUSES = ["match_uuid", "match_composite", "odoo_only"] as const;

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

async function unifiedGetArAging(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("invoices_unified")
    .select("amount_residual, odoo_amount_residual_mxn, days_overdue")
    .eq("direction", "issued")
    .in("match_status", UNIFIED_MATCH_STATUSES)
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds));

  const rows = (data ?? []) as Array<{
    amount_residual: number | null;
    odoo_amount_residual_mxn: number | null;
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
        (acc, r) => acc + (Number(r.odoo_amount_residual_mxn ?? r.amount_residual) || 0),
        0
      ),
    };
  });
}

export const getArAging = unstable_cache(
  unifiedGetArAging,
  ["invoices-ar-aging-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

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
    .from("analytics_ar_aging")
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
  // SAT fields (populated by unified path; null in legacy path)
  uuid_sat: string | null;
  estado_sat: string | null;
}

async function unifiedGetOverdueInvoices(limit: number): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("invoices_unified")
    .select(
      "odoo_invoice_id, odoo_ref, company_id, odoo_amount_total, odoo_amount_total_mxn, amount_residual, odoo_amount_residual_mxn, odoo_currency, days_overdue, due_date, invoice_date, payment_state, salesperson_name, salesperson_user_id, uuid_sat, estado_sat"
    )
    .eq("direction", "issued")
    .in("match_status", UNIFIED_MATCH_STATUSES)
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds))
    .order("odoo_amount_residual_mxn", { ascending: false, nullsFirst: false })
    .limit(limit);

  type Raw = {
    odoo_invoice_id: number | null;
    odoo_ref: string | null;
    company_id: number | null;
    odoo_amount_total: number | null;
    odoo_amount_total_mxn: number | null;
    amount_residual: number | null;
    odoo_amount_residual_mxn: number | null;
    odoo_currency: string | null;
    days_overdue: number | null;
    due_date: string | null;
    invoice_date: string | null;
    payment_state: string | null;
    salesperson_name: string | null;
    salesperson_user_id: number | null;
    uuid_sat: string | null;
    estado_sat: string | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: Number(row.odoo_invoice_id) || 0,
    name: row.odoo_ref,
    company_id: row.company_id,
    company_name: null, // invoices_unified doesn't have company_name directly
    amount_total_mxn: Number(row.odoo_amount_total_mxn ?? row.odoo_amount_total) || 0,
    amount_residual_mxn: Number(row.odoo_amount_residual_mxn ?? row.amount_residual) || 0,
    currency: row.odoo_currency,
    days_overdue: row.days_overdue,
    due_date: row.due_date,
    invoice_date: row.invoice_date,
    payment_state: row.payment_state,
    salesperson_name: row.salesperson_name,
    uuid_sat: row.uuid_sat,
    estado_sat: row.estado_sat,
  }));
}

const _getOverdueInvoicesCached = unstable_cache(
  unifiedGetOverdueInvoices,
  ["invoices-overdue-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

export async function getOverdueInvoices(
  limit = 50
): Promise<OverdueInvoice[]> {
  return _getOverdueInvoicesCached(limit);
}

// ──────────────────────────────────────────────────────────────────────────
// Facturas vencidas — versión paginada + filtrable (para DataTableToolbar)
// ──────────────────────────────────────────────────────────────────────────
export interface OverdueInvoicePage {
  rows: OverdueInvoice[];
  total: number;
}

const OVERDUE_SORT_MAP_UNIFIED: Record<string, string> = {
  amount: "amount_residual",
  days: "days_overdue",
  due: "due_date",
  invoice: "invoice_date",
  name: "odoo_ref",
};

async function unifiedGetOverdueInvoicesPage(
  params: TableParams & {
    bucket?: string[];
    salesperson?: string[];
  }
): Promise<OverdueInvoicePage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  const sortCol =
    (params.sort && OVERDUE_SORT_MAP_UNIFIED[params.sort]) ?? "amount_residual";
  const ascending = params.sortDir === "asc";

  const [start, end] = paginationRange(params.page, params.size);

  let query = sb
    .from("invoices_unified")
    .select(
      "odoo_invoice_id, odoo_ref, company_id, odoo_amount_total, odoo_amount_total_mxn, amount_residual, odoo_amount_residual_mxn, odoo_currency, days_overdue, due_date, invoice_date, payment_state, salesperson_name, salesperson_user_id, uuid_sat, estado_sat",
      { count: "exact" }
    )
    .eq("direction", "issued")
    .in("match_status", UNIFIED_MATCH_STATUSES)
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .not("company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("invoice_date", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("invoice_date", next);
  }
  if (params.q) query = query.ilike("odoo_ref", `%${params.q}%`);
  if (params.salesperson && params.salesperson.length > 0) {
    query = query.in("salesperson_name", params.salesperson);
  }

  if (params.bucket && params.bucket.length > 0) {
    const orParts: string[] = [];
    for (const b of params.bucket) {
      if (b === "1-30") orParts.push("and(days_overdue.gte.1,days_overdue.lte.30)");
      else if (b === "31-60")
        orParts.push("and(days_overdue.gte.31,days_overdue.lte.60)");
      else if (b === "61-90")
        orParts.push("and(days_overdue.gte.61,days_overdue.lte.90)");
      else if (b === "91-120")
        orParts.push("and(days_overdue.gte.91,days_overdue.lte.120)");
      else if (b === "120+") orParts.push("days_overdue.gte.121");
    }
    if (orParts.length > 0) query = query.or(orParts.join(","));
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  type Raw = {
    odoo_invoice_id: number | null;
    odoo_ref: string | null;
    company_id: number | null;
    odoo_amount_total: number | null;
    odoo_amount_total_mxn: number | null;
    amount_residual: number | null;
    odoo_amount_residual_mxn: number | null;
    odoo_currency: string | null;
    days_overdue: number | null;
    due_date: string | null;
    invoice_date: string | null;
    payment_state: string | null;
    salesperson_name: string | null;
    salesperson_user_id: number | null;
    uuid_sat: string | null;
    estado_sat: string | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: Number(row.odoo_invoice_id) || 0,
    name: row.odoo_ref,
    company_id: row.company_id,
    company_name: null,
    amount_total_mxn: Number(row.odoo_amount_total_mxn ?? row.odoo_amount_total) || 0,
    amount_residual_mxn: Number(row.odoo_amount_residual_mxn ?? row.amount_residual) || 0,
    currency: row.odoo_currency,
    days_overdue: row.days_overdue,
    due_date: row.due_date,
    invoice_date: row.invoice_date,
    payment_state: row.payment_state,
    salesperson_name: row.salesperson_name,
    uuid_sat: row.uuid_sat,
    estado_sat: row.estado_sat,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getOverdueInvoicesPage(
  params: TableParams & {
    bucket?: string[]; // "1-30" | "31-60" | "61-90" | "91-120" | "120+"
    salesperson?: string[];
  }
): Promise<OverdueInvoicePage> {
  return unifiedGetOverdueInvoicesPage(params);
}

/**
 * Opciones distinct para el facet "Vendedor" en cobranza.
 * Lightweight: solo nombres únicos entre las facturas vencidas.
 */
async function unifiedGetOverdueSalespeopleOptions(): Promise<string[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("invoices_unified")
    .select("salesperson_name")
    .eq("direction", "issued")
    .in("match_status", UNIFIED_MATCH_STATUSES)
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial", "in_payment"])
    .not("days_overdue", "eq", 0)
    .not("salesperson_name", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);
  const names = new Set<string>();
  for (const r of (data ?? []) as Array<{ salesperson_name: string | null }>) {
    if (r.salesperson_name) names.add(r.salesperson_name);
  }
  return [...names].sort();
}

export const getOverdueSalespeopleOptions = unstable_cache(
  unifiedGetOverdueSalespeopleOptions,
  ["invoices-overdue-salespeople-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);

// ──────────────────────────────────────────────────────────────────────────
// Company aging — versión paginada + filtrable
// ──────────────────────────────────────────────────────────────────────────
export interface CompanyAgingPage {
  rows: CompanyAgingRow[];
  total: number;
}

export async function getCompanyAgingPage(
  params: TableParams & { tier?: string[] }
): Promise<CompanyAgingPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortMap: Record<string, string> = {
    total: "total_receivable",
    revenue: "total_revenue",
    "1_30": "overdue_1_30",
    "31_60": "overdue_31_60",
    "61_90": "overdue_61_90",
    "90plus": "overdue_90plus",
    company: "company_name",
  };
  const sortCol = (params.sort && sortMap[params.sort]) ?? "total_receivable";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("analytics_ar_aging")
    .select(
      "company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue",
      { count: "exact" }
    )
    .gt("total_receivable", 0)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.tier && params.tier.length > 0) {
    query = query.in("tier", params.tier);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<CompanyAgingRow>>).map((r) => ({
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

  return { rows, total: count ?? rows.length };
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

export interface PaymentPredictionsPage {
  rows: PaymentPredictionRow[];
  total: number;
}

const PAYMENT_PREDICTION_SORT_MAP: Record<string, string> = {
  pending: "total_pending",
  max_overdue: "max_days_overdue",
  avg_days: "avg_days_to_pay",
  company: "company_name",
};

export async function getPaymentPredictionsPage(
  params: TableParams & { risk?: string[]; trend?: string[] }
): Promise<PaymentPredictionsPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && PAYMENT_PREDICTION_SORT_MAP[params.sort]) ??
    "total_pending";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("payment_predictions")
    .select(
      "company_id, company_name, tier, payment_risk, payment_trend, avg_days_to_pay, median_days_to_pay, max_days_overdue, total_pending, pending_count, predicted_payment_date",
      { count: "exact" }
    )
    .gt("total_pending", 0)
    .not("payment_risk", "ilike", "NORMAL%")
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.risk && params.risk.length > 0) {
    // Match "CRITICO%" / "ALTO%" / "MEDIO%" prefixes
    const orParts = params.risk.map((r) => `payment_risk.ilike.${r}%`);
    query = query.or(orParts.join(","));
  }
  if (params.trend && params.trend.length > 0) {
    query = query.in("payment_trend", params.trend);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<PaymentPredictionRow>>).map(
    (r) => ({
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
    })
  );

  return { rows, total: count ?? rows.length };
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

async function _getPaymentRiskKpisRaw(): Promise<{
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

export const getPaymentRiskKpis = unstable_cache(
  _getPaymentRiskKpisRaw,
  ["invoices-payment-risk-kpis-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);
