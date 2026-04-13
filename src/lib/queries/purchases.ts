import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveCompanyNames } from "./_helpers";
import { toMxn } from "@/lib/formatters";

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
      .select("amount_residual, currency")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"]),
  ]);

  const monthTotal = ((curr.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const prevMonthTotal = ((prev.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const supplierPayable = ((ap.data ?? []) as Array<{
    amount_residual: number | null;
    currency: string | null;
  }>).reduce((a, r) => a + toMxn(r.amount_residual, r.currency), 0);

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
      "id, name, company_id, amount_total_mxn, buyer_name, date_order, state"
    )
    .order("date_order", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<Omit<RecentPurchaseOrder, "company_name">>;
  const nameMap = await resolveCompanyNames(
    sb,
    rows.map((r) => r.company_id)
  );

  return rows.map((row) => ({
    ...row,
    company_name:
      row.company_id != null ? (nameMap.get(Number(row.company_id)) ?? null) : null,
  }));
}
