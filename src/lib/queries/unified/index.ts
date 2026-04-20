import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

export type Severity = "critical" | "high" | "medium" | "low";
export type MatchStatus = "match_uuid" | "match_composite" | "ambiguous" | "syntage_only" | "odoo_only";

export interface UnifiedInvoice {
  canonical_id: string;
  uuid_sat: string | null;
  odoo_invoice_id: number | null;
  match_status: MatchStatus;
  match_quality: string;
  direction: "issued" | "received";
  estado_sat: string | null;
  fecha_timbrado: string | null;
  fecha_cancelacion: string | null;
  total_fiscal: number | null;
  odoo_amount_total: number | null;
  amount_residual: number | null;
  payment_state: string | null;
  odoo_state: string | null;
  invoice_date: string | null;
  due_date: string | null;
  days_overdue: number | null;
  odoo_amount_total_mxn: number | null;
  odoo_amount_residual_mxn: number | null;
  salesperson_name: string | null;
  salesperson_user_id: number | null;
  odoo_currency: string | null;
  moneda_fiscal: string | null;
  partner_name: string | null;
  company_id: number | null;
  odoo_company_id: number | null;
  emisor_rfc: string | null;
  receptor_rfc: string | null;
  emisor_blacklist_status: string | null;
  receptor_blacklist_status: string | null;
  fiscal_operational_consistency: string | null;
  amount_diff: number | null;
  odoo_ref: string | null;
  email_id_origen: number | null;
}

export interface UnifiedAgingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  amount: number;
  count: number;
}

export interface UnifiedRevenueAggregate {
  revenue: number;
  count: number;
  uuidValidated: number;
  pctValidated: number;
}

export interface UnifiedReconciliationCounts {
  open: number;
  bySeverity: Record<Severity, number>;
}

export interface UnifiedRefreshStaleness {
  invoicesRefreshedAt: string | null;
  paymentsRefreshedAt: string | null;
  minutesSinceRefresh: number;
}

export function isComputableRevenue(row: {
  direction?: string | null;
  match_status?: string | null;
  estado_sat?: string | null;
  odoo_state?: string | null;
}): boolean {
  if (row.direction !== "issued") return false;
  if (!row.match_status || !["match_uuid", "match_composite", "odoo_only"].includes(row.match_status)) return false;
  if ((row.estado_sat ?? "vigente") === "cancelado") return false;
  if (row.odoo_state != null && row.odoo_state !== "posted") return false;
  return true;
}

export async function getUnifiedInvoicesForCompany(
  companyId: number,
  opts?: { direction?: "issued" | "received"; includeNonComputable?: boolean }
): Promise<UnifiedInvoice[]> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified").select("*").eq("company_id", companyId);
  if (opts?.direction) q = q.eq("direction", opts.direction);
  if (!opts?.includeNonComputable) {
    q = q.in("match_status", ["match_uuid", "match_composite", "odoo_only"])
         .not("estado_sat", "eq", "cancelado");
  }
  const { data, error } = await q.order("invoice_date", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as UnifiedInvoice[];
}

export async function getUnifiedRevenueAggregates(
  fromDate: string,
  toDate: string,
  opts?: { companyId?: number }
): Promise<UnifiedRevenueAggregate> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified")
    .select("match_status,odoo_amount_total,odoo_amount_total_mxn,uuid_sat,estado_sat,odoo_state,direction")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .gte("invoice_date", fromDate)
    .lte("invoice_date", toDate)
    .not("estado_sat", "eq", "cancelado");
  if (opts?.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ match_status: string; odoo_amount_total: number | null; odoo_amount_total_mxn: number | null; uuid_sat: string | null }>;
  const revenue = rows.reduce((s, r) => s + (r.odoo_amount_total_mxn ?? r.odoo_amount_total ?? 0), 0);
  const count = rows.length;
  const uuidValidated = rows.filter((r) => r.uuid_sat !== null).length;
  const pctValidated = count > 0 ? (uuidValidated / count) * 100 : 0;
  return { revenue, count, uuidValidated, pctValidated };
}

export async function getUnifiedCashFlowAging(
  opts?: { companyId?: number }
): Promise<UnifiedAgingBucket[]> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified")
    .select("amount_residual,odoo_amount_residual_mxn,days_overdue,match_status,estado_sat,odoo_state,direction,payment_state")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial", "in_payment"]);
  if (opts?.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ amount_residual: number | null; odoo_amount_residual_mxn: number | null; days_overdue: number | null }>;
  const buckets: Record<UnifiedAgingBucket["bucket"], UnifiedAgingBucket> = {
    "0-30":  { bucket: "0-30",  amount: 0, count: 0 },
    "31-60": { bucket: "31-60", amount: 0, count: 0 },
    "61-90": { bucket: "61-90", amount: 0, count: 0 },
    "90+":   { bucket: "90+",   amount: 0, count: 0 },
  };
  for (const r of rows) {
    const d = r.days_overdue ?? 0;
    const a = r.odoo_amount_residual_mxn ?? r.amount_residual ?? 0;
    const key: UnifiedAgingBucket["bucket"] = d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
    buckets[key].amount += a;
    buckets[key].count += 1;
  }
  return Object.values(buckets);
}

export async function getUnifiedReconciliationCounts(
  companyId: number
): Promise<UnifiedReconciliationCounts> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("reconciliation_issues")
    .select("severity")
    .eq("company_id", companyId)
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ severity: Severity }>;
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of rows) bySeverity[r.severity] += 1;
  return { open: rows.length, bySeverity };
}

async function _getUnifiedRefreshStalenessRaw(): Promise<UnifiedRefreshStaleness> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { invoices_unified_refreshed_at?: string | null; payments_unified_refreshed_at?: string | null };
  const invRef = d.invoices_unified_refreshed_at ?? null;
  const payRef = d.payments_unified_refreshed_at ?? null;
  const refs = [invRef, payRef].filter((x): x is string => x != null);
  if (refs.length === 0) return { invoicesRefreshedAt: null, paymentsRefreshedAt: null, minutesSinceRefresh: 99999 };
  const oldestRef = refs.sort()[0];
  const minutesSinceRefresh = Math.round((Date.now() - new Date(oldestRef).getTime()) / 60_000);
  return { invoicesRefreshedAt: invRef, paymentsRefreshedAt: payRef, minutesSinceRefresh };
}

export const getUnifiedRefreshStaleness = unstable_cache(
  _getUnifiedRefreshStalenessRaw,
  ["unified-refresh-staleness-v1"],
  { revalidate: 60, tags: ["invoices-unified"] }
);
