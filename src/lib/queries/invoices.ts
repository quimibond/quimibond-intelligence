import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export interface OverdueInvoice {
  id: number | string;
  name: string | null;
  company_id: number | string | null;
  company_name: string | null;
  amount_total_mxn: number | null;
  amount_residual_mxn: number | null;
  days_overdue: number | null;
  due_date: string | null;
  invoice_date: string | null;
  payment_state: string | null;
  salesperson_name: string | null;
}

export async function getOverdueInvoices(
  limit = 50
): Promise<OverdueInvoice[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_invoices")
    .select(
      "id, name, company_id, amount_total_mxn, amount_residual_mxn, days_overdue, due_date, invoice_date, payment_state, salesperson_name, companies:company_id(name)"
    )
    .eq("move_type", "out_invoice")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0)
    .order("amount_residual_mxn", { ascending: false })
    .limit(limit);

  type Raw = Omit<OverdueInvoice, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    name: row.name,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    amount_total_mxn: row.amount_total_mxn,
    amount_residual_mxn: row.amount_residual_mxn,
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

const BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: "1-30", min: 1, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "91-120", min: 91, max: 120 },
  { label: "120+", min: 121, max: null },
];

export async function getArAging(): Promise<ArAgingBucket[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_invoices")
    .select("amount_residual_mxn, days_overdue")
    .eq("move_type", "out_invoice")
    .in("payment_state", ["not_paid", "partial"])
    .gt("days_overdue", 0);

  const rows = (data ?? []) as Array<{
    amount_residual_mxn: number | null;
    days_overdue: number | null;
  }>;

  return BUCKETS.map((b) => {
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
