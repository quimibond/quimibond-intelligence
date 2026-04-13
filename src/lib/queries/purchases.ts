import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface PurchasesKpis {
  monthTotal: number;
  prevMonthTotal: number;
  trendPct: number;
  poCount: number;
  supplierPayable: number;
}

export async function getPurchasesKpis(): Promise<PurchasesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const prevStart = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [curr, prev, ap] = await Promise.all([
    sb
      .from("odoo_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", thisStart)
      .lt("date_order", nextStart),
    sb
      .from("odoo_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", prevStart)
      .lt("date_order", thisStart),
    sb
      .from("odoo_invoices")
      .select("amount_residual_mxn")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"]),
  ]);

  const sum = (rows: Array<{ amount_total_mxn?: number | null; amount_residual_mxn?: number | null }>, field: "amount_total_mxn" | "amount_residual_mxn") =>
    rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);

  const monthTotal = sum((curr.data ?? []) as Array<{ amount_total_mxn: number | null }>, "amount_total_mxn");
  const prevMonthTotal = sum((prev.data ?? []) as Array<{ amount_total_mxn: number | null }>, "amount_total_mxn");
  const supplierPayable = sum((ap.data ?? []) as Array<{ amount_residual_mxn: number | null }>, "amount_residual_mxn");

  return {
    monthTotal,
    prevMonthTotal,
    trendPct:
      prevMonthTotal > 0
        ? ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100
        : 0,
    poCount: (curr.data ?? []).length,
    supplierPayable,
  };
}

export interface RecentPurchaseOrder {
  id: number | string;
  name: string | null;
  company_id: number | string | null;
  company_name: string | null;
  amount_total_mxn: number | null;
  buyer_name: string | null;
  date_order: string | null;
  state: string | null;
}

export async function getRecentPurchaseOrders(
  limit = 25
): Promise<RecentPurchaseOrder[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_purchase_orders")
    .select(
      "id, name, company_id, amount_total_mxn, buyer_name, date_order, state, companies:company_id(name)"
    )
    .order("date_order", { ascending: false })
    .limit(limit);
  type Raw = Omit<RecentPurchaseOrder, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    name: row.name,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    amount_total_mxn: row.amount_total_mxn,
    buyer_name: row.buyer_name,
    date_order: row.date_order,
    state: row.state,
  }));
}
