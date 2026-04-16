import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveCompanyNames } from "./_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "./table-params";

/**
 * Purchases queries v2 — usa views canónicas:
 * - `cfo_dashboard` — pagos a proveedores 30d, cuentas por pagar
 * - `supplier_concentration_herfindahl` — productos con concentración riesgosa
 * - `purchase_price_intelligence` — alertas de precios anormales
 * - `supplier_product_matrix` — qué proveedor da qué producto
 * - `odoo_purchase_orders` — pedidos crudos
 * - `odoo_invoices` (in_invoice) — facturas de proveedores
 */

function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface PurchasesKpis {
  monthTotal: number;
  prevMonthTotal: number;
  trendPct: number;
  poCount: number;
  supplierPayable: number;
  pagosProv30d: number;
  singleSourceCount: number;
  singleSourceSpent: number;
}

export async function getPurchasesKpis(): Promise<PurchasesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );
  const prevStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() - 1, 1)
  );

  const [curr, prev, ap, cfo, herfindahl] = await Promise.all([
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
    sb.from("cfo_dashboard").select("pagos_prov_30d").maybeSingle(),
    sb
      .from("supplier_concentration_herfindahl")
      .select("total_spent_12m")
      .eq("concentration_level", "single_source"),
  ]);

  const monthTotal = ((curr.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const prevMonthTotal = ((prev.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const supplierPayable = ((ap.data ?? []) as Array<{
    amount_residual_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_residual_mxn) || 0), 0);

  const ssRows = (herfindahl.data ?? []) as Array<{
    total_spent_12m: number | null;
  }>;
  const singleSourceSpent = ssRows.reduce(
    (a, r) => a + (Number(r.total_spent_12m) || 0),
    0
  );

  return {
    monthTotal,
    prevMonthTotal,
    trendPct:
      prevMonthTotal > 0
        ? ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100
        : 0,
    poCount: (curr.data ?? []).length,
    supplierPayable,
    // `cfo_dashboard.pagos_prov_30d` viene signado en negativo (outflow).
    // En `/compras` se renderiza como KPI "Pagos 30d" con `format=currency`
    // — sin Math.abs se lee como "-$25.1M" (pérdida). La magnitud del
    // volumen de egresos es lo relevante aquí; el signo lo guarda
    // `finance.ts` para `/finanzas` donde sí se usa en `cobros + pagos`.
    pagosProv30d: Math.abs(
      Number(
        (cfo.data as { pagos_prov_30d: number | null } | null)?.pagos_prov_30d,
      ) || 0,
    ),
    singleSourceCount: ssRows.length,
    singleSourceSpent,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Single-source risk — productos con UN solo proveedor
// ──────────────────────────────────────────────────────────────────────────
export interface SingleSourceRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  top_supplier_name: string | null;
  top_supplier_company_id: number | null;
  total_spent_12m: number;
  concentration_level: string;
  herfindahl_idx: number;
  top_supplier_share_pct: number;
}

export interface SingleSourcePage {
  rows: SingleSourceRow[];
  total: number;
}

const SINGLE_SOURCE_SORT_MAP: Record<string, string> = {
  spent: "total_spent_12m",
  herfindahl: "herfindahl_idx",
  share: "top_supplier_share_pct",
  ref: "product_ref",
  name: "product_name",
};

export async function getSingleSourceRiskPage(
  params: TableParams & { level?: string[] }
): Promise<SingleSourcePage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && SINGLE_SOURCE_SORT_MAP[params.sort]) ?? "total_spent_12m";
  const ascending = params.sortDir === "asc";

  const levels =
    params.level && params.level.length > 0
      ? params.level
      : ["single_source", "very_high", "high"];

  let query = sb
    .from("supplier_concentration_herfindahl")
    .select(
      "odoo_product_id, product_ref, product_name, top_supplier_name, top_supplier_company_id, total_spent_12m, concentration_level, herfindahl_idx, top_supplier_share_pct",
      { count: "exact" }
    )
    .in("concentration_level", levels);

  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%,top_supplier_name.ilike.%${params.q}%`
    );
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<SingleSourceRow>>).map((r) => ({
    odoo_product_id: Number(r.odoo_product_id) || 0,
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    top_supplier_name: r.top_supplier_name ?? null,
    top_supplier_company_id:
      r.top_supplier_company_id != null
        ? Number(r.top_supplier_company_id)
        : null,
    total_spent_12m: Number(r.total_spent_12m) || 0,
    concentration_level: r.concentration_level ?? "—",
    herfindahl_idx: Number(r.herfindahl_idx) || 0,
    top_supplier_share_pct: Number(r.top_supplier_share_pct) || 0,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getSingleSourceRisk(
  limit = 20
): Promise<SingleSourceRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("supplier_concentration_herfindahl")
    .select(
      "odoo_product_id, product_ref, product_name, top_supplier_name, top_supplier_company_id, total_spent_12m, concentration_level, herfindahl_idx, top_supplier_share_pct"
    )
    .in("concentration_level", ["single_source", "very_high"])
    .order("total_spent_12m", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<SingleSourceRow>>).map((r) => ({
    odoo_product_id: Number(r.odoo_product_id) || 0,
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    top_supplier_name: r.top_supplier_name ?? null,
    top_supplier_company_id:
      r.top_supplier_company_id != null
        ? Number(r.top_supplier_company_id)
        : null,
    total_spent_12m: Number(r.total_spent_12m) || 0,
    concentration_level: r.concentration_level ?? "—",
    herfindahl_idx: Number(r.herfindahl_idx) || 0,
    top_supplier_share_pct: Number(r.top_supplier_share_pct) || 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Price anomalies — productos comprados arriba del promedio
// ──────────────────────────────────────────────────────────────────────────
export interface PriceAnomalyRow {
  product_ref: string | null;
  product_name: string | null;
  currency: string | null;
  last_supplier: string | null;
  last_price: number | null;
  prev_price: number | null;
  avg_price: number | null;
  price_change_pct: number | null;
  price_vs_avg_pct: number | null;
  price_flag: string;
  total_spent: number;
  last_purchase_date: string | null;
}

export interface PriceAnomaliesPage {
  rows: PriceAnomalyRow[];
  total: number;
}

const PRICE_ANOMALY_SORT_MAP: Record<string, string> = {
  spent: "total_spent",
  change: "price_change_pct",
  vs_avg: "price_vs_avg_pct",
  last_price: "last_price",
  date: "last_purchase_date",
};

export async function getPriceAnomaliesPage(
  params: TableParams & { flag?: string[] }
): Promise<PriceAnomaliesPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && PRICE_ANOMALY_SORT_MAP[params.sort]) ?? "total_spent";
  const ascending = params.sortDir === "asc";

  const flags =
    params.flag && params.flag.length > 0
      ? params.flag
      : ["price_above_avg", "price_below_avg"];

  let query = sb
    .from("purchase_price_intelligence")
    .select(
      "product_ref, product_name, currency, last_supplier, last_price, prev_price, avg_price, price_change_pct, price_vs_avg_pct, price_flag, total_spent, last_purchase_date",
      { count: "exact" }
    )
    .in("price_flag", flags);

  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%,last_supplier.ilike.%${params.q}%`
    );
  }
  if (params.from) query = query.gte("last_purchase_date", params.from);
  if (params.to) query = query.lte("last_purchase_date", params.to);

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<PriceAnomalyRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    currency: r.currency ?? null,
    last_supplier: r.last_supplier ?? null,
    last_price: r.last_price != null ? Number(r.last_price) : null,
    prev_price: r.prev_price != null ? Number(r.prev_price) : null,
    avg_price: r.avg_price != null ? Number(r.avg_price) : null,
    price_change_pct:
      r.price_change_pct != null ? Number(r.price_change_pct) : null,
    price_vs_avg_pct:
      r.price_vs_avg_pct != null ? Number(r.price_vs_avg_pct) : null,
    price_flag: r.price_flag ?? "—",
    total_spent: Number(r.total_spent) || 0,
    last_purchase_date: r.last_purchase_date ?? null,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getPriceAnomalies(
  limit = 30
): Promise<PriceAnomalyRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("purchase_price_intelligence")
    .select(
      "product_ref, product_name, currency, last_supplier, last_price, prev_price, avg_price, price_change_pct, price_vs_avg_pct, price_flag, total_spent, last_purchase_date"
    )
    .in("price_flag", ["price_above_avg", "price_below_avg"])
    .order("total_spent", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<PriceAnomalyRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    currency: r.currency ?? null,
    last_supplier: r.last_supplier ?? null,
    last_price: r.last_price != null ? Number(r.last_price) : null,
    prev_price: r.prev_price != null ? Number(r.prev_price) : null,
    avg_price: r.avg_price != null ? Number(r.avg_price) : null,
    price_change_pct:
      r.price_change_pct != null ? Number(r.price_change_pct) : null,
    price_vs_avg_pct:
      r.price_vs_avg_pct != null ? Number(r.price_vs_avg_pct) : null,
    price_flag: r.price_flag ?? "—",
    total_spent: Number(r.total_spent) || 0,
    last_purchase_date: r.last_purchase_date ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Recent purchase orders
// ──────────────────────────────────────────────────────────────────────────
export interface RecentPurchaseOrder {
  id: number;
  name: string | null;
  company_id: number | null;
  company_name: string | null;
  amount_total_mxn: number | null;
  buyer_name: string | null;
  date_order: string | null;
  state: string | null;
}

export interface RecentPurchaseOrderPage {
  rows: RecentPurchaseOrder[];
  total: number;
}

const PO_SORT_MAP: Record<string, string> = {
  date: "date_order",
  amount: "amount_total_mxn",
  name: "name",
  state: "state",
};

export async function getPurchaseOrdersPage(
  params: TableParams & { state?: string[]; buyer?: string[] }
): Promise<RecentPurchaseOrderPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol = (params.sort && PO_SORT_MAP[params.sort]) ?? "date_order";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("odoo_purchase_orders")
    .select(
      "id, name, company_id, amount_total_mxn, buyer_name, date_order, state",
      { count: "exact" }
    );

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.buyer && params.buyer.length > 0) {
    query = query.in("buyer_name", params.buyer);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = (data ?? []) as Array<Omit<RecentPurchaseOrder, "company_name">>;
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

export async function getPurchaseBuyerOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data } = await sb
    .from("odoo_purchase_orders")
    .select("buyer_name")
    .gte("date_order", since.toISOString().slice(0, 10))
    .not("buyer_name", "is", null)
    .limit(3000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ buyer_name: string | null }>) {
    if (r.buyer_name) set.add(r.buyer_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
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
      row.company_id != null
        ? (nameMap.get(Number(row.company_id)) ?? null)
        : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top suppliers (12m spent)
// ──────────────────────────────────────────────────────────────────────────
export interface TopSupplierRow {
  supplier_name: string;
  total_spent: number;
  product_count: number;
  order_count: number;
}

export interface TopSuppliersPage {
  rows: TopSupplierRow[];
  total: number;
}

/**
 * Top proveedores paginados + búsqueda. Se agrega en memoria porque la
 * view `supplier_product_matrix` es por supplier×product, no por supplier.
 */
export async function getTopSuppliersPage(
  params: TableParams
): Promise<TopSuppliersPage> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("supplier_product_matrix")
    .select("supplier_name, purchase_value, purchase_orders, odoo_product_id")
    .gt("purchase_value", 0);

  const rows = (data ?? []) as Array<{
    supplier_name: string | null;
    purchase_value: number | null;
    purchase_orders: number | null;
    odoo_product_id: number | null;
  }>;
  const buckets = new Map<
    string,
    { spent: number; products: Set<number>; orders: number }
  >();
  for (const r of rows) {
    if (!r.supplier_name) continue;
    const b = buckets.get(r.supplier_name) ?? {
      spent: 0,
      products: new Set<number>(),
      orders: 0,
    };
    b.spent += Number(r.purchase_value) || 0;
    if (r.odoo_product_id) b.products.add(r.odoo_product_id);
    b.orders += Number(r.purchase_orders) || 0;
    buckets.set(r.supplier_name, b);
  }

  let all: TopSupplierRow[] = [...buckets.entries()].map(
    ([supplier_name, v]) => ({
      supplier_name,
      total_spent: v.spent,
      product_count: v.products.size,
      order_count: v.orders,
    })
  );

  if (params.q) {
    const needle = params.q.toLowerCase();
    all = all.filter((r) => r.supplier_name.toLowerCase().includes(needle));
  }

  const sortMap: Record<string, keyof TopSupplierRow> = {
    spent: "total_spent",
    products: "product_count",
    orders: "order_count",
    name: "supplier_name",
  };
  const sortCol: keyof TopSupplierRow =
    params.sort && sortMap[params.sort] ? sortMap[params.sort] : "total_spent";
  const asc = params.sortDir === "asc";
  all.sort((a, b) => {
    const va = a[sortCol];
    const vb = b[sortCol];
    if (typeof va === "number" && typeof vb === "number")
      return asc ? va - vb : vb - va;
    return asc
      ? String(va).localeCompare(String(vb), "es")
      : String(vb).localeCompare(String(va), "es");
  });

  const total = all.length;
  const [start, end] = paginationRange(params.page, params.size);
  return { rows: all.slice(start, end + 1), total };
}

export async function getTopSuppliers(limit = 15): Promise<TopSupplierRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("supplier_product_matrix")
    .select("supplier_name, purchase_value, purchase_orders, odoo_product_id")
    .gt("purchase_value", 0);
  const rows = (data ?? []) as Array<{
    supplier_name: string | null;
    purchase_value: number | null;
    purchase_orders: number | null;
    odoo_product_id: number | null;
  }>;
  const buckets = new Map<
    string,
    { spent: number; products: Set<number>; orders: number }
  >();
  for (const r of rows) {
    if (!r.supplier_name) continue;
    const b = buckets.get(r.supplier_name) ?? {
      spent: 0,
      products: new Set<number>(),
      orders: 0,
    };
    b.spent += Number(r.purchase_value) || 0;
    if (r.odoo_product_id) b.products.add(r.odoo_product_id);
    b.orders += Number(r.purchase_orders) || 0;
    buckets.set(r.supplier_name, b);
  }
  return [...buckets.entries()]
    .map(([supplier_name, v]) => ({
      supplier_name,
      total_spent: v.spent,
      product_count: v.products.size,
      order_count: v.orders,
    }))
    .sort((a, b) => b.total_spent - a.total_spent)
    .slice(0, limit);
}
