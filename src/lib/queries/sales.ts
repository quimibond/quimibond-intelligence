import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export interface SalesKpis {
  monthTotal: number;
  prevMonthTotal: number;
  trendPct: number;
  orderCount: number;
  avgOrderValue: number;
  topSalesperson: string | null;
}

function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getSalesKpis(): Promise<SalesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const prevStart = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [curr, prev] = await Promise.all([
    sb
      .from("odoo_sale_orders")
      .select("amount_total_mxn, salesperson_name")
      .gte("date_order", thisStart)
      .lt("date_order", nextStart),
    sb
      .from("odoo_sale_orders")
      .select("amount_total_mxn")
      .gte("date_order", prevStart)
      .lt("date_order", thisStart),
  ]);

  const currRows = (curr.data ?? []) as Array<{
    amount_total_mxn: number | null;
    salesperson_name: string | null;
  }>;
  const prevRows = (prev.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>;

  const monthTotal = currRows.reduce(
    (a, r) => a + (Number(r.amount_total_mxn) || 0),
    0
  );
  const prevMonthTotal = prevRows.reduce(
    (a, r) => a + (Number(r.amount_total_mxn) || 0),
    0
  );

  const salespeople: Record<string, number> = {};
  for (const r of currRows) {
    if (!r.salesperson_name) continue;
    salespeople[r.salesperson_name] =
      (salespeople[r.salesperson_name] ?? 0) + (Number(r.amount_total_mxn) || 0);
  }
  const topSalesperson =
    Object.entries(salespeople).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    monthTotal,
    prevMonthTotal,
    trendPct:
      prevMonthTotal > 0
        ? ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100
        : 0,
    orderCount: currRows.length,
    avgOrderValue: currRows.length > 0 ? monthTotal / currRows.length : 0,
    topSalesperson,
  };
}

export interface RecentSaleOrder {
  id: number | string;
  name: string | null;
  company_id: number | string | null;
  company_name: string | null;
  amount_total_mxn: number | null;
  salesperson_name: string | null;
  date_order: string | null;
  state: string | null;
}

export async function getRecentSaleOrders(
  limit = 25
): Promise<RecentSaleOrder[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_sale_orders")
    .select(
      "id, name, company_id, amount_total_mxn, salesperson_name, date_order, state, companies:company_id(name)"
    )
    .order("date_order", { ascending: false })
    .limit(limit);
  type Raw = Omit<RecentSaleOrder, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    name: row.name,
    company_id: row.company_id,
    company_name: joinedCompanyName(row.companies),
    amount_total_mxn: row.amount_total_mxn,
    salesperson_name: row.salesperson_name,
    date_order: row.date_order,
    state: row.state,
  }));
}
