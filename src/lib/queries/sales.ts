import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList, resolveCompanyNames } from "./_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "./table-params";

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

  const selfIds = await getSelfCompanyIds();
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
      .neq("state", "cancel")
      .not("company_id", "in", pgInList(selfIds)),
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

/**
 * Serie mensual de ingresos para el chart de /ventas.
 *
 * Usa `pl_estado_resultados.ingresos` — MISMA fuente que el KPI "Ingresos
 * del mes" en `getSalesKpis`. Antes el KPI usaba P&L pero el chart venía
 * de `monthly_revenue_by_company.net_revenue`, que incluye out_invoices
 * booked a cuentas no-income (leasing, intercompany). Para Mar-2026 eso
 * producía un delta del 79% entre el número del KPI ($14.4M) y la barra
 * ($25.7M) en la misma página — mismo label "ingresos".
 *
 * `ma3m` ahora se computa client-side con ventana rodante de 3 meses
 * sobre `pl_estado_resultados` (antes venía del MV).
 */
export async function getSalesRevenueTrend(
  months = 12
): Promise<RevenueTrendPoint[]> {
  const sb = getServiceClient();
  // Pedimos `months + 2` para tener contexto para el ma3m del mes más
  // antiguo de la ventana, pero solo devolvemos los últimos `months`.
  const { data } = await sb
    .from("pl_estado_resultados")
    .select("period, ingresos")
    .order("period", { ascending: false })
    .limit(months + 2);

  const rows = ((data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const y = Number(r.period.split("-")[0]);
      return y >= 2020 && y <= 2030;
    })
    .map((r) => ({
      period: r.period!.slice(0, 7),
      revenue: Number(r.ingresos) || 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const points: RevenueTrendPoint[] = rows.map((r, i) => {
    const window = rows.slice(Math.max(0, i - 2), i + 1);
    const ma3m =
      window.length > 0
        ? window.reduce((s, w) => s + w.revenue, 0) / window.length
        : 0;
    return { period: r.period, revenue: r.revenue, ma3m };
  });

  return points.slice(-months);
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

export interface ReorderRiskPage {
  rows: ReorderRiskRow[];
  total: number;
}

const REORDER_SORT_MAP: Record<string, string> = {
  revenue: "total_revenue",
  days_overdue: "days_overdue_reorder",
  avg_cycle: "avg_cycle_days",
  days_since: "days_since_last",
  avg_order: "avg_order_value",
  company: "company_name",
};

export async function getReorderRiskPage(
  params: TableParams & { status?: string[]; tier?: string[] }
): Promise<ReorderRiskPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && REORDER_SORT_MAP[params.sort]) ?? "total_revenue";
  const ascending = params.sortDir === "asc";

  const statuses =
    params.status && params.status.length > 0
      ? params.status
      : ["overdue", "at_risk", "critical"];

  let query = sb
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name, top_product_ref, predicted_next_order",
      { count: "exact" }
    )
    .in("reorder_status", statuses)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.tier && params.tier.length > 0) {
    query = query.in("tier", params.tier);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<{
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

  return { rows, total: count ?? rows.length };
}

export async function getReorderRisk(
  limit = 30
): Promise<ReorderRiskRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name, top_product_ref, predicted_next_order"
    )
    .in("reorder_status", ["overdue", "at_risk", "critical"])
    .not("company_id", "in", pgInList(selfIds))
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

export interface TopCustomersPage {
  rows: TopCustomerRow[];
  total: number;
}

const TOP_CUSTOMER_SORT_MAP: Record<string, string> = {
  revenue_90d: "revenue_90d",
  revenue_total: "total_revenue",
  name: "name",
};

export async function getTopCustomersPage(
  params: TableParams
): Promise<TopCustomersPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && TOP_CUSTOMER_SORT_MAP[params.sort]) ?? "revenue_90d";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("company_profile")
    .select("company_id, name, revenue_90d, total_revenue", {
      count: "exact",
    })
    .gt("revenue_90d", 0)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("name", `%${params.q}%`);

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const baseRows = (data ?? []) as Array<{
    company_id: number;
    name: string;
    revenue_90d: number | null;
    total_revenue: number | null;
  }>;

  if (baseRows.length === 0) {
    return { rows: [], total: count ?? 0 };
  }

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

  const rows: TopCustomerRow[] = baseRows.map((r) => ({
    company_id: r.company_id,
    company_name: r.name,
    revenue_90d: Number(r.revenue_90d) || 0,
    total_revenue_lifetime: Number(r.total_revenue) || 0,
    margin_12m: marginMap.get(r.company_id)?.margin_12m ?? null,
    margin_pct_12m: marginMap.get(r.company_id)?.margin_pct_12m ?? null,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getTopCustomers(limit = 15): Promise<TopCustomerRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  // company_profile already has revenue_90d
  const { data } = await sb
    .from("company_profile")
    .select("company_id, name, revenue_90d, total_revenue")
    .gt("revenue_90d", 0)
    .not("company_id", "in", pgInList(selfIds))
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

  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("odoo_sale_orders")
    .select("salesperson_name, amount_total_mxn")
    .gte("date_order", thisStart)
    .lt("date_order", nextStart)
    .neq("state", "cancel")
    .not("salesperson_name", "is", null)
    .not("company_id", "in", pgInList(selfIds));

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

export interface RecentSaleOrderPage {
  rows: RecentSaleOrder[];
  total: number;
}

const SALE_ORDER_SORT_MAP: Record<string, string> = {
  date: "date_order",
  amount: "amount_total_mxn",
  name: "name",
  state: "state",
};

/**
 * Sale orders paginadas + filtrables para la tabla de ventas.
 */
export async function getSaleOrdersPage(
  params: TableParams & { state?: string[]; salesperson?: string[] }
): Promise<RecentSaleOrderPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol =
    (params.sort && SALE_ORDER_SORT_MAP[params.sort]) ?? "date_order";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("odoo_sale_orders")
    .select(
      "id, name, company_id, amount_total_mxn, salesperson_name, date_order, state",
      { count: "exact" }
    )
    .not("company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.salesperson && params.salesperson.length > 0) {
    query = query.in("salesperson_name", params.salesperson);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = (data ?? []) as Array<Omit<RecentSaleOrder, "company_name">>;
  const nameMap = await resolveCompanyNames(
    sb,
    rows.map((r) => r.company_id)
  );

  return {
    total: count ?? rows.length,
    rows: rows.map((row) => ({
      ...row,
      company_name:
        row.company_id != null
          ? (nameMap.get(Number(row.company_id)) ?? null)
          : null,
    })),
  };
}

export async function getSaleOrderSalespeopleOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data } = await sb
    .from("odoo_sale_orders")
    .select("salesperson_name")
    .gte("date_order", since.toISOString().slice(0, 10))
    .not("salesperson_name", "is", null)
    .limit(3000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ salesperson_name: string | null }>) {
    if (r.salesperson_name) set.add(r.salesperson_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Serie temporal de sale orders para el chart stacked area. */
export interface SaleOrdersTimelineBucket {
  week: string;
  draft: number;
  sent: number;
  sale: number;
  done: number;
  cancel: number;
}

function isoMondayKey(date: Date): string {
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + diffToMonday
    )
  );
  return monday.toISOString().slice(0, 10);
}

export async function getSaleOrdersTimeline(params: {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  state?: string[];
  salesperson?: string[];
  maxRows?: number;
}): Promise<SaleOrdersTimelineBucket[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  let query = sb
    .from("odoo_sale_orders")
    .select("amount_total_mxn, date_order, state")
    .not("company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.salesperson && params.salesperson.length > 0) {
    query = query.in("salesperson_name", params.salesperson);
  }

  const { data } = await query
    .order("date_order", { ascending: true })
    .limit(params.maxRows ?? 2000);

  const buckets = new Map<string, SaleOrdersTimelineBucket>();
  for (const r of (data ?? []) as Array<{
    amount_total_mxn: number | null;
    date_order: string | null;
    state: string | null;
  }>) {
    if (!r.date_order) continue;
    const d = new Date(r.date_order);
    if (Number.isNaN(d.getTime())) continue;
    const key = isoMondayKey(d);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        week: key,
        draft: 0,
        sent: 0,
        sale: 0,
        done: 0,
        cancel: 0,
      };
      buckets.set(key, bucket);
    }
    const amt = Number(r.amount_total_mxn) || 0;
    const s = (r.state ?? "draft") as keyof SaleOrdersTimelineBucket;
    if (s !== "week" && s in bucket) {
      bucket[s] = (bucket[s] as number) + amt;
    }
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.week.localeCompare(b.week)
  );
}

export async function getRecentSaleOrders(
  limit = 25
): Promise<RecentSaleOrder[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("odoo_sale_orders")
    .select(
      "id, name, company_id, amount_total_mxn, salesperson_name, date_order, state"
    )
    .not("company_id", "in", pgInList(selfIds))
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
