import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";
import { toMxn } from "@/lib/formatters";

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
 * Facturas vencidas. Sumamos en MXN via `toMxn()` porque las columnas
 * `amount_*_mxn` están NULL en odoo_invoices.
 */
export async function getOverdueInvoices(
  limit = 50
): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_invoices")
    .select(
      "id, name, company_id, amount_total, amount_residual, currency, days_overdue, due_date, invoice_date, payment_state, salesperson_name, companies:company_id(name)"
    )
    .eq("move_type", "out_invoice")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .order("amount_residual", { ascending: false })
    .limit(limit);

  type Raw = {
    id: number;
    name: string | null;
    company_id: number | null;
    amount_total: number | null;
    amount_residual: number | null;
    currency: string | null;
    days_overdue: number | null;
    due_date: string | null;
    invoice_date: string | null;
    payment_state: string | null;
    salesperson_name: string | null;
    companies: unknown;
  };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    name: row.name,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    amount_total_mxn: toMxn(row.amount_total, row.currency),
    amount_residual_mxn: toMxn(row.amount_residual, row.currency),
    currency: row.currency,
    days_overdue: row.days_overdue,
    due_date: row.due_date,
    invoice_date: row.invoice_date,
    payment_state: row.payment_state,
    salesperson_name: row.salesperson_name,
  }));
}

export interface ArAgingBucket {
  bucket: string;
  count: number;
  amount_mxn: number;
}

/**
 * AR aging buckets usando la MV `ar_aging_detail`.
 * La MV trae `aging_bucket` pre-computado: current, 1-30, 31-60, 61-90, 91-120, 120+.
 * Filtramos "current" porque queremos solo vencido.
 */
export async function getArAging(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("ar_aging_detail")
    .select("aging_bucket, amount_residual, currency, bucket_sort")
    .gt("bucket_sort", 1); // skip "current" (bucket_sort=1)

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
