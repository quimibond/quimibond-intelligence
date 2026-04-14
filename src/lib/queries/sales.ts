import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveCompanyNames } from "./_helpers";

/**
 * Sales queries v2 — usa views canónicas:
 * - `pl_estado_resultados` — ingresos por mes (P&L oficial)
 * - `monthly_revenue_by_company` — revenue por empresa×mes con MA3m, MA6m, MoM%, YoY%
 * - `client_reorder_predictions` — clientes en riesgo de no reordenar
 * - `customer_margin_analysis` — margen total por cliente
 * - `odoo_sale_orders` — pedidos crudos (con amount_total_mxn populated)
 */

// ──────────────────────────────────────────────────────────────────────────
// KPIs principales del mes
// ──────────────────────────────────────────────────────────────────────────
export interface SalesKpis {
  ingresosMes: number;
  ingresosMesAnt: number;
  ingresosMomPct: number;
  ingresosYoy: number;
  ingresosYoyPct: number;
  ma3m: number;
  utilidadOperativaMes: number;
  pedidosMes: number;
  ticketPromedio: number;
  topSalesperson: string | null;
  topSalespersonAmount: number;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getSalesKpis(): Promise<SalesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const currKey = monthKey(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prev);
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const yearAgoKey = monthKey(yearAgo);

  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const [pl, monthlyRev, salesOrders] = await Promise.all([
    sb
      .from("pl_estado_resultados")
      .select("period, ingresos, utilidad_operativa")
      .order("period", { ascending: false })
      .limit(24),
    sb
      .from("monthly_revenue_by_company")
      .select("month, net_revenue, ma_3m")
      .order("month", { ascending: false })
      .limit(60),
    sb
      .from("odoo_sale_orders")
      .select("amount_total_mxn, salesperson_name")
      .gte("date_order", thisStart)
      .lt("date_order", nextStart)
      .neq("state", "cancel"),
  ]);

  // P&L lookups (filter bad years)
  const plRows = ((pl.data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
    utilidad_operativa: number | null;
  }>).filter((r) => {
    if (!r.period) return false;
    const y = Number(r.period.split("-")[0]);
    return y >= 2020 && y <= 2030;
  });
  const curr = plRows.find((r) => r.period === currKey);
  const prevRow = plRows.find((r) => r.period === prevKey);
  const yearAgoRow = plRows.find((r) => r.period === yearAgoKey);

  const ingresosMes = Number(curr?.ingresos) || 0;
  const ingresosMesAnt = Number(prevRow?.ingresos) || 0;
  const ingresosYoy = Number(yearAgoRow?.ingresos) || 0;
  const utilidadOperativaMes = Number(curr?.utilidad_operativa) || 0;
  const ingresosMomPct =
    ingresosMesAnt > 0
      ? ((ingresosMes - ingresosMesAnt) / ingresosMesAnt) * 100
      : 0;
  const ingresosYoyPct =
    ingresosYoy > 0 ? ((ingresosMes - ingresosYoy) / ingresosYoy) * 100 : 0;

  // MA3m del mes actual (suma todos los company para este mes)
  const monthlyRows = (monthlyRev.data ?? []) as Array<{
    month: string | null;
    net_revenue: number | null;
    ma_3m: number | null;
  }>;
  const currMonthRows = monthlyRows.filter(
    (r) => r.month && r.month.slice(0, 7) === currKey
  );
  const ma3m =
    currMonthRows.length > 0
      ? currMonthRows.reduce((a, r) => a + (Number(r.ma_3m) || 0), 0) /
        currMonthRows.length
      : 0;

  // Sale orders del mes (crudo) → top vendedor
  const orderRows = (salesOrders.data ?? []) as Array<{
    amount_total_mxn: number | null;
    salesperson_name: string | null;
  }>;
  const orderTotal = orderRows.reduce(
    (a, r) => a + (Number(r.amount_total_mxn) || 0),
    0
  );
  const salespeople: Record<string, number> = {};
  for (const r of orderRows) {
    if (!r.salesperson_name) continue;
    salespeople[r.salesperson_name] =
      (salespeople[r.salesperson_name] ?? 0) +
      (Number(r.amount_total_mxn) || 0);
  }
  const topSp = Object.entries(salespeople).sort((a, b) => b[1] - a[1])[0];

  return {
    ingresosMes,
    ingresosMesAnt,
    ingresosMomPct,
    ingresosYoy,
    ingresosYoyPct,
    ma3m,
    utilidadOperativaMes,
    pedidosMes: orderRows.length,
    ticketPromedio: orderRows.length > 0 ? orderTotal / orderRows.length : 0,
    topSalesperson: topSp?.[0] ?? null,
    topSalespersonAmount: topSp?.[1] ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Revenue trend con MA3m
// ──────────────────────────────────────────────────────────────────────────
export interface RevenueTrendPoint {
  period: string;
  revenue: number;
  ma3m: number;
}

export async function getSalesRevenueTrend(
  months = 12
): Promise<RevenueTrendPoint[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = monthStart(since);

  const { data } = await sb
    .from("monthly_revenue_by_company")
    .select("month, net_revenue, ma_3m")
    .gte("month", sinceStr)
    .order("month", { ascending: true });

  const buckets = new Map<
    string,
    { revenue: number; ma3mSum: number; count: number }
  >();
  for (const row of (data ?? []) as Array<{
    month: string | null;
    net_revenue: number | null;
    ma_3m: number | null;
  }>) {
    if (!row.month) continue;
    const key = row.month.slice(0, 7);
    const entry = buckets.get(key) ?? { revenue: 0, ma3mSum: 0, count: 0 };
    entry.revenue += Number(row.net_revenue) || 0;
    entry.ma3mSum += Number(row.ma_3m) || 0;
    entry.count += 1;
    buckets.set(key, entry);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      revenue: v.revenue,
      ma3m: v.count > 0 ? v.ma3mSum / v.count : 0,
    }));
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder risk — clientes que deberían haber comprado y no
// ──────────────────────────────────────────────────────────────────────────
export interface ReorderRiskRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  status: string;
  avg_cycle_days: number | null;
  days_since_last: number | null;
  days_overdue_reorder: number | null;
  avg_order_value: number | null;
  total_revenue: number | null;
  salesperson_name: string | null;
  top_product_ref: string | null;
  predicted_next_order: string | null;
}

export async function getReorderRisk(
  limit = 30
): Promise<ReorderRiskRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name, top_product_ref, predicted_next_order"
    )
    .in("reorder_status", ["overdue", "at_risk", "critical"])
    .order("total_revenue", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{
    company_id: number;
    company_name: string | null;
    tier: string | null;
    reorder_status: string;
    avg_cycle_days: number | null;
    days_since_last: number | null;
    days_overdue_reorder: number | null;
    avg_order_value: number | null;
    total_revenue: number | null;
    salesperson_name: string | null;
    top_product_ref: string | null;
    predicted_next_order: string | null;
  }>).map((r) => ({
    company_id: r.company_id,
    company_name: r.company_name,
    tier: r.tier,
    status: r.reorder_status,
    avg_cycle_days: r.avg_cycle_days,
    days_since_last: r.days_since_last,
    days_overdue_reorder: r.days_overdue_reorder,
    avg_order_value: r.avg_order_value,
    total_revenue: r.total_revenue,
    salesperson_name: r.salesperson_name,
    top_product_ref: r.top_product_ref,
    predicted_next_order: r.predicted_next_order,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top customers (90d)
// ──────────────────────────────────────────────────────────────────────────
export interface TopCustomerRow {
  company_id: number;
  company_name: string;
  revenue_90d: number;
  margin_12m: number | null;
  margin_pct_12m: number | null;
  total_revenue_lifetime: number;
}

export async function getTopCustomers(limit = 15): Promise<TopCustomerRow[]> {
  const sb = getServiceClient();
  // company_profile already has revenue_90d
  const { data } = await sb
    .from("company_profile")
    .select("company_id, name, revenue_90d, total_revenue")
    .gt("revenue_90d", 0)
    .order("revenue_90d", { ascending: false })
    .limit(limit);

  const baseRows = (data ?? []) as Array<{
    company_id: number;
    name: string;
    revenue_90d: number | null;
    total_revenue: number | null;
  }>;
  if (baseRows.length === 0) return [];

  const ids = baseRows.map((r) => r.company_id);
  const { data: marginData } = await sb
    .from("customer_margin_analysis")
    .select("company_id, margin_12m, margin_pct_12m")
    .in("company_id", ids);
  const marginMap = new Map<
    number,
    { margin_12m: number | null; margin_pct_12m: number | null }
  >();
  for (const m of (marginData ?? []) as Array<{
    company_id: number;
    margin_12m: number | null;
    margin_pct_12m: number | null;
  }>) {
    marginMap.set(m.company_id, {
      margin_12m: m.margin_12m,
      margin_pct_12m: m.margin_pct_12m,
    });
  }

  return baseRows.map((r) => ({
    company_id: r.company_id,
    company_name: r.name,
    revenue_90d: Number(r.revenue_90d) || 0,
    total_revenue_lifetime: Number(r.total_revenue) || 0,
    margin_12m: marginMap.get(r.company_id)?.margin_12m ?? null,
    margin_pct_12m: marginMap.get(r.company_id)?.margin_pct_12m ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top salespeople del mes
// ──────────────────────────────────────────────────────────────────────────
export interface SalespersonRow {
  name: string;
  total_amount: number;
  order_count: number;
}

export async function getTopSalespeople(): Promise<SalespersonRow[]> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const { data } = await sb
    .from("odoo_sale_orders")
    .select("salesperson_name, amount_total_mxn")
    .gte("date_order", thisStart)
    .lt("date_order", nextStart)
    .neq("state", "cancel")
    .not("salesperson_name", "is", null);

  const buckets = new Map<string, { total: number; count: number }>();
  for (const r of (data ?? []) as Array<{
    salesperson_name: string | null;
    amount_total_mxn: number | null;
  }>) {
    if (!r.salesperson_name) continue;
    const b = buckets.get(r.salesperson_name) ?? { total: 0, count: 0 };
    b.total += Number(r.amount_total_mxn) || 0;
    b.count += 1;
    buckets.set(r.salesperson_name, b);
  }

  return [...buckets.entries()]
    .map(([name, v]) => ({
      name,
      total_amount: v.total,
      order_count: v.count,
    }))
    .sort((a, b) => b.total_amount - a.total_amount);
}

// ──────────────────────────────────────────────────────────────────────────
// Recent sale orders (kept from previous version)
// ──────────────────────────────────────────────────────────────────────────
export interface RecentSaleOrder {
  id: number;
  name: string | null;
  company_id: number | null;
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
      "id, name, company_id, amount_total_mxn, salesperson_name, date_order, state"
    )
    .order("date_order", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<Omit<RecentSaleOrder, "company_name">>;
  const nameMap = await resolveCompanyNames(
    sb,
    rows.map((r) => r.company_id)
  );
  return rows.map((row) => ({
    ...row,
    company_name:
      row.company_id != null
        ? (nameMap.get(Number(row.company_id)) ?? null)
        : null,
  }));
}
