import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { paginationRange, type TableParams } from "../_shared/table-params";

/**
 * Products queries SP5 — uses canonical/gold layer:
 * - `canonical_products` (table) — golden product catalog (SP3 MDM)
 * - `gold_product_performance` (view) — revenue/margin/velocity per product
 * - `canonical_order_lines` (MV) — SP4 canonical order lines (sale + purchase)
 * - `inventory_velocity` (view) — daily run rate, days of stock, reorder_status  SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
 * - `dead_stock_analysis` (MV) — products with no movement  SP5-VERIFIED: dead_stock_analysis retained (§12 KEEP)
 * - `product_real_cost` (MV) — BOM-derived real unit cost  SP5-VERIFIED: product_real_cost retained (§12 KEEP)
 * - `client_reorder_predictions` (MV) — per-client reorder signals  SP5-VERIFIED: client_reorder_predictions retained (§12 KEEP)
 * - `overhead_factor_12m` (MV) — overhead allocation factor  SP5-VERIFIED: overhead_factor_12m retained (§12 KEEP)
 * - `purchase_price_intelligence` (MV) — purchase price trends  SP5-VERIFIED: purchase_price_intelligence retained (§12 KEEP)
 * - `product_seasonality` — DOES NOT EXIST (dropped before SP5); readers stubbed as TODO SP6
 *
 * Banned (dropped in SP1): product_margin_analysis, customer_product_matrix,
 * supplier_product_matrix, supplier_price_index, product_price_history, products_unified
 */

// ──────────────────────────────────────────────────────────────────────────
// canonical_products list / search
// ──────────────────────────────────────────────────────────────────────────

export async function listProducts(opts: {
  search?: string;
  limit?: number;
  onlyActive?: boolean;
  categoryLike?: string;
} = {}) {
  const sb = getServiceClient();
  let q = sb.from("canonical_products").select("*");
  if (opts.search) {
    q = q.or(
      `internal_ref.ilike.%${opts.search}%,display_name.ilike.%${opts.search}%`
    );
  }
  if (opts.onlyActive) q = q.eq("is_active", true);
  // canonical_products.category (not category_path — SP5 drift)
  if (opts.categoryLike) q = q.ilike("category", `%${opts.categoryLike}%`);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Back-compat alias */
export const searchProducts = listProducts;

// ──────────────────────────────────────────────────────────────────────────
// gold_product_performance — top SKUs by revenue
// ──────────────────────────────────────────────────────────────────────────
// Schema drift vs plan: gold_product_performance uses odoo_revenue_12m_mxn
// (not revenue_mxn_12m), units_sold_12m, unique_customers_12m (no margin_mxn_12m).

export async function fetchTopSkusByRevenue(opts: { limit?: number } = {}) {
  const sb = getServiceClient();
  // SP5-VERIFIED: gold_product_performance retained (§12 KEEP+rewire category)
  const { data, error } = await sb
    .from("gold_product_performance")
    .select(
      "canonical_product_id, internal_ref, display_name, category, odoo_revenue_12m_mxn, sat_revenue_12m_mxn, units_sold_12m, unique_customers_12m, margin_pct_12m, stock_qty, available_qty, is_active"
    )
    .order("odoo_revenue_12m_mxn", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 20);
  if (error) throw error;
  return data ?? [];
}

/** Back-compat alias */
export const topProductsByRevenue = fetchTopSkusByRevenue;

// ──────────────────────────────────────────────────────────────────────────
// fetchProductPerformance — single product gold view
// ──────────────────────────────────────────────────────────────────────────

export async function fetchProductPerformance(canonical_product_id: number) {
  const sb = getServiceClient();
  // SP5-VERIFIED: gold_product_performance retained (§12 KEEP+rewire category)
  const { data, error } = await sb
    .from("gold_product_performance")
    .select("*")
    .eq("canonical_product_id", canonical_product_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Back-compat alias */
export const getProductPerformance = fetchProductPerformance;

// ──────────────────────────────────────────────────────────────────────────
// fetchSupplierPriceIntelligence — canonical_order_lines (purchase) agg
// ──────────────────────────────────────────────────────────────────────────
// Replaces supplier_price_index (dropped SP1). Uses canonical_order_lines MV.

export async function fetchSupplierPriceIntelligence(
  canonical_product_id: number
) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_order_lines")
    .select(
      "canonical_company_id, price_unit, qty, currency, order_date, subtotal_mxn"
    )
    .eq("canonical_product_id", canonical_product_id)
    .eq("order_type", "purchase")
    .order("order_date", { ascending: false })
    .limit(500);
  if (error) throw error;

  type OlPurchaseRow = {
    canonical_company_id: number | null;
    price_unit: number | null;
    qty: number | null;
    currency: string | null;
    order_date: string | null;
    subtotal_mxn: number | null;
  };
  const bySupplier: Record<
    number,
    { n: number; totalQty: number; prices: number[]; lastDate: string | null }
  > = {};
  for (const r of (data ?? []) as OlPurchaseRow[]) {
    const k = Number(r.canonical_company_id);
    if (!k) continue;
    bySupplier[k] ??= { n: 0, totalQty: 0, prices: [], lastDate: null };
    bySupplier[k].n += 1;
    bySupplier[k].totalQty += Number(r.qty ?? 0);
    bySupplier[k].prices.push(Number(r.price_unit ?? 0));
    if (
      !bySupplier[k].lastDate ||
      (r.order_date && r.order_date > bySupplier[k].lastDate!)
    ) {
      bySupplier[k].lastDate = r.order_date;
    }
  }
  return Object.entries(bySupplier).map(([id, agg]) => ({
    canonical_company_id: Number(id),
    lines: agg.n,
    total_qty: agg.totalQty,
    min_price: agg.prices.length ? Math.min(...agg.prices) : null,
    max_price: agg.prices.length ? Math.max(...agg.prices) : null,
    avg_price: agg.prices.length
      ? agg.prices.reduce((a, b) => a + b, 0) / agg.prices.length
      : null,
    last_purchase_at: agg.lastDate,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// fetchCompanyProductMatrix — canonical_order_lines (sale or purchase) agg
// ──────────────────────────────────────────────────────────────────────────
// Replaces customer_product_matrix + supplier_product_matrix (dropped SP1).

export async function fetchCompanyProductMatrix(
  canonical_company_id: number,
  direction: "customer" | "supplier"
) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_order_lines")
    .select(
      "canonical_product_id, product_ref, product_name, qty, subtotal_mxn, subtotal, order_date"
    )
    .eq("order_type", direction === "customer" ? "sale" : "purchase")
    .eq("canonical_company_id", canonical_company_id)
    .order("order_date", { ascending: false })
    .limit(2000);
  if (error) throw error;

  type OlMatrixRow = {
    canonical_product_id: number | null;
    product_ref: string | null;
    product_name: string | null;
    qty: number | null;
    subtotal_mxn: number | null;
    subtotal: number | null;
    order_date: string | null;
  };
  const byProduct: Record<
    number,
    {
      canonical_product_id: number;
      product_ref: string | null;
      product_name: string | null;
      n: number;
      totalQty: number;
      totalRevenue: number;
      lastAt: string | null;
    }
  > = {};
  for (const r of (data ?? []) as OlMatrixRow[]) {
    const p = Number(r.canonical_product_id);
    if (!p) continue;
    byProduct[p] ??= {
      canonical_product_id: p,
      product_ref: r.product_ref ?? null,
      product_name: r.product_name ?? null,
      n: 0,
      totalQty: 0,
      totalRevenue: 0,
      lastAt: null,
    };
    byProduct[p].n += 1;
    byProduct[p].totalQty += Number(r.qty ?? 0);
    byProduct[p].totalRevenue += Number(r.subtotal_mxn ?? r.subtotal ?? 0);
    if (
      !byProduct[p].lastAt ||
      (r.order_date && r.order_date > byProduct[p].lastAt!)
    )
      byProduct[p].lastAt = r.order_date;
  }
  return Object.values(byProduct)
    .map((v) => ({
      canonical_product_id: v.canonical_product_id,
      product_ref: v.product_ref,
      product_name: v.product_name,
      lines: v.n,
      total_qty: v.totalQty,
      total_revenue_mxn: v.totalRevenue,
      last_order_at: v.lastAt,
    }))
    .sort((a, b) => b.total_revenue_mxn - a.total_revenue_mxn);
}

// ──────────────────────────────────────────────────────────────────────────
// fetchProductSeasonality — STUBBED (product_seasonality MV does not exist)
// ──────────────────────────────────────────────────────────────────────────
// TODO SP6: product_seasonality MV was dropped before SP5. Implement via
// canonical_order_lines monthly aggregation grouped by month-of-year.

export async function fetchProductSeasonality(
  _canonical_product_id: number
): Promise<null> {
  // TODO SP6: product_seasonality MV does not exist (dropped before SP5).
  // Reimplement via canonical_order_lines GROUP BY EXTRACT(month FROM order_date).
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface ProductsKpis {
  catalogActive: number;
  needsReorder: number;
  noMovementCount: number;
  noMovementValue: number;
  stockValue: number;
  avgMarginPct: number;
}

export async function getProductsKpis(): Promise<ProductsKpis> {
  const sb = getServiceClient();
  const [catalog, velocity, deadStock, perf] = await Promise.all([
    sb
      .from("canonical_products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
      .from("inventory_velocity")
      .select("reorder_status, stock_value"),
    sb // SP5-VERIFIED: dead_stock_analysis retained (§12 KEEP)
      .from("dead_stock_analysis")
      .select("inventory_value"),
    sb // SP5-VERIFIED: gold_product_performance retained (§12 KEEP+rewire category)
      .from("gold_product_performance")
      .select("margin_pct_12m")
      .not("margin_pct_12m", "is", null),
  ]);

  const velocityRows = (velocity.data ?? []) as Array<{
    reorder_status: string | null;
    stock_value: number | null;
  }>;
  const needsReorder = velocityRows.filter(
    (r) =>
      r.reorder_status === "urgent_14d" ||
      r.reorder_status === "reorder_30d" ||
      r.reorder_status === "stockout"
  ).length;
  const noMovement = velocityRows.filter(
    (r) => r.reorder_status === "no_movement"
  );
  const noMovementValue = noMovement.reduce(
    (a, r) => a + (Number(r.stock_value) || 0),
    0
  );
  const stockValue = velocityRows.reduce(
    (a, r) => a + (Number(r.stock_value) || 0),
    0
  );

  const perfRows = (perf.data ?? []) as Array<{
    margin_pct_12m: number | null;
  }>;
  const validMargins = perfRows.filter(
    (r) => r.margin_pct_12m != null && Number(r.margin_pct_12m) > 0
  );
  const avgMarginPct =
    validMargins.length > 0
      ? validMargins.reduce((a, r) => a + (Number(r.margin_pct_12m) || 0), 0) /
        validMargins.length
      : 0;

  return {
    catalogActive: catalog.count ?? 0,
    needsReorder,
    noMovementCount: noMovement.length,
    noMovementValue,
    stockValue,
    avgMarginPct,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder needed (urgent_14d + reorder_30d + stockout)
// ──────────────────────────────────────────────────────────────────────────
export interface ReorderRow {
  product_ref: string | null;
  product_name: string | null;
  category: string | null;
  reorder_status: string;
  stock_qty: number;
  available_qty: number;
  daily_run_rate: number | null;
  days_of_stock: number | null;
  qty_sold_90d: number;
  reorder_min: number | null;
  customers_12m: number;
  last_sale_date: string | null;
}

export async function getReorderNeeded(limit = 50): Promise<ReorderRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
    .from("inventory_velocity")
    .select(
      "product_ref, product_name, category, reorder_status, stock_qty, available_qty, daily_run_rate, days_of_stock, qty_sold_90d, reorder_min, customers_12m, last_sale_date"
    )
    .in("reorder_status", ["stockout", "urgent_14d", "reorder_30d"])
    .order("daily_run_rate", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<ReorderRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    category: r.category ?? null,
    reorder_status: r.reorder_status ?? "—",
    stock_qty: Number(r.stock_qty) || 0,
    available_qty: Number(r.available_qty) || 0,
    daily_run_rate:
      r.daily_run_rate != null ? Number(r.daily_run_rate) : null,
    days_of_stock: r.days_of_stock != null ? Number(r.days_of_stock) : null,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    reorder_min: r.reorder_min != null ? Number(r.reorder_min) : null,
    customers_12m: Number(r.customers_12m) || 0,
    last_sale_date: r.last_sale_date ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Inventario paginado + filtros (status, category, búsqueda por ref/nombre)
// ──────────────────────────────────────────────────────────────────────────
export interface InventoryPage {
  rows: ReorderRow[];
  total: number;
}

const INVENTORY_STATUSES = [
  "stockout",
  "urgent_14d",
  "reorder_30d",
  "healthy",
  "excess",
  "no_movement",
] as const;

const INVENTORY_SORT_MAP: Record<string, string> = {
  run_rate: "daily_run_rate",
  days_of_stock: "days_of_stock",
  stock: "stock_qty",
  qty_sold: "qty_sold_90d",
  customers: "customers_12m",
  ref: "product_ref",
  name: "product_name",
};

export async function getInventoryPage(
  params: TableParams & {
    status?: string[];
    category?: string[];
  }
): Promise<InventoryPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol =
    (params.sort && INVENTORY_SORT_MAP[params.sort]) ?? "daily_run_rate";
  const ascending = params.sortDir === "asc";

  let query = sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
    .from("inventory_velocity")
    .select(
      "product_ref, product_name, category, reorder_status, stock_qty, available_qty, daily_run_rate, days_of_stock, qty_sold_90d, reorder_min, customers_12m, last_sale_date",
      { count: "exact" }
    );

  const statuses =
    params.status && params.status.length > 0
      ? params.status
      : ["stockout", "urgent_14d", "reorder_30d"];
  query = query.in("reorder_status", statuses);

  if (params.category && params.category.length > 0) {
    query = query.in("category", params.category);
  }
  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%`
    );
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<ReorderRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    category: r.category ?? null,
    reorder_status: r.reorder_status ?? "—",
    stock_qty: Number(r.stock_qty) || 0,
    available_qty: Number(r.available_qty) || 0,
    daily_run_rate:
      r.daily_run_rate != null ? Number(r.daily_run_rate) : null,
    days_of_stock: r.days_of_stock != null ? Number(r.days_of_stock) : null,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    reorder_min: r.reorder_min != null ? Number(r.reorder_min) : null,
    customers_12m: Number(r.customers_12m) || 0,
    last_sale_date: r.last_sale_date ?? null,
  }));

  return { rows, total: count ?? rows.length };
}

export const INVENTORY_STATUS_OPTIONS = INVENTORY_STATUSES;

export async function getProductCategoryOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
    .from("inventory_velocity")
    .select("category")
    .not("category", "is", null)
    .limit(5000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ category: string | null }>) {
    if (r.category) set.add(r.category);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

// ──────────────────────────────────────────────────────────────────────────
// Top movers — productos con mayor velocidad de venta
// ──────────────────────────────────────────────────────────────────────────
export interface TopMoverRow {
  product_ref: string | null;
  product_name: string | null;
  qty_sold_90d: number;
  qty_sold_180d: number;
  qty_sold_365d: number;
  customers_12m: number;
  daily_run_rate: number | null;
  days_of_stock: number | null;
  stock_value: number;
  annual_turnover: number | null;
}

export interface TopMoversPage {
  rows: TopMoverRow[];
  total: number;
}

const TOP_MOVER_SORT_MAP: Record<string, string> = {
  qty_90d: "qty_sold_90d",
  qty_180d: "qty_sold_180d",
  qty_365d: "qty_sold_365d",
  customers: "customers_12m",
  run_rate: "daily_run_rate",
  days_of_stock: "days_of_stock",
  stock_value: "stock_value",
  turnover: "annual_turnover",
};

export async function getTopMoversPage(
  params: TableParams
): Promise<TopMoversPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && TOP_MOVER_SORT_MAP[params.sort]) ?? "qty_sold_90d";
  const ascending = params.sortDir === "asc";

  let query = sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
    .from("inventory_velocity")
    .select(
      "product_ref, product_name, qty_sold_90d, qty_sold_180d, qty_sold_365d, customers_12m, daily_run_rate, days_of_stock, stock_value, annual_turnover",
      { count: "exact" }
    )
    .gt("qty_sold_90d", 0);

  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%`
    );
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<TopMoverRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    qty_sold_180d: Number(r.qty_sold_180d) || 0,
    qty_sold_365d: Number(r.qty_sold_365d) || 0,
    customers_12m: Number(r.customers_12m) || 0,
    daily_run_rate:
      r.daily_run_rate != null ? Number(r.daily_run_rate) : null,
    days_of_stock: r.days_of_stock != null ? Number(r.days_of_stock) : null,
    stock_value: Number(r.stock_value) || 0,
    annual_turnover:
      r.annual_turnover != null ? Number(r.annual_turnover) : null,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getTopMovers(limit = 15): Promise<TopMoverRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
    .from("inventory_velocity")
    .select(
      "product_ref, product_name, qty_sold_90d, qty_sold_180d, qty_sold_365d, customers_12m, daily_run_rate, days_of_stock, stock_value, annual_turnover"
    )
    .gt("qty_sold_90d", 0)
    .order("qty_sold_90d", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<TopMoverRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    qty_sold_180d: Number(r.qty_sold_180d) || 0,
    qty_sold_365d: Number(r.qty_sold_365d) || 0,
    customers_12m: Number(r.customers_12m) || 0,
    daily_run_rate:
      r.daily_run_rate != null ? Number(r.daily_run_rate) : null,
    days_of_stock:
      r.days_of_stock != null ? Number(r.days_of_stock) : null,
    stock_value: Number(r.stock_value) || 0,
    annual_turnover:
      r.annual_turnover != null ? Number(r.annual_turnover) : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Dead stock
// ──────────────────────────────────────────────────────────────────────────
export interface DeadStockRow {
  product_ref: string | null;
  product_name: string | null;
  inventory_value: number;
  days_since_last_sale: number;
  stock_qty: number;
  last_sale_date: string | null;
  historical_customers: number;
  lifetime_revenue: number;
}

export interface DeadStockPage {
  rows: DeadStockRow[];
  total: number;
}

const DEAD_STOCK_SORT_MAP: Record<string, string> = {
  value: "inventory_value",
  days: "days_since_last_sale",
  stock: "stock_qty",
  customers: "historical_customers",
  revenue: "lifetime_revenue",
};

export async function getDeadStockPage(
  params: TableParams
): Promise<DeadStockPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && DEAD_STOCK_SORT_MAP[params.sort]) ?? "inventory_value";
  const ascending = params.sortDir === "asc";

  let query = sb // SP5-VERIFIED: dead_stock_analysis retained (§12 KEEP)
    .from("dead_stock_analysis")
    .select(
      "product_ref, product_name, inventory_value, days_since_last_sale, stock_qty, last_sale_date, historical_customers, lifetime_revenue",
      { count: "exact" }
    );

  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%`
    );
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<DeadStockRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    inventory_value: Number(r.inventory_value) || 0,
    days_since_last_sale: Number(r.days_since_last_sale) || 0,
    stock_qty: Number(r.stock_qty) || 0,
    last_sale_date: r.last_sale_date ?? null,
    historical_customers: Number(r.historical_customers) || 0,
    lifetime_revenue: Number(r.lifetime_revenue) || 0,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getDeadStock(limit = 20): Promise<DeadStockRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: dead_stock_analysis retained (§12 KEEP)
    .from("dead_stock_analysis")
    .select(
      "product_ref, product_name, inventory_value, days_since_last_sale, stock_qty, last_sale_date, historical_customers, lifetime_revenue"
    )
    .order("inventory_value", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<DeadStockRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    inventory_value: Number(r.inventory_value) || 0,
    days_since_last_sale: Number(r.days_since_last_sale) || 0,
    stock_qty: Number(r.stock_qty) || 0,
    last_sale_date: r.last_sale_date ?? null,
    historical_customers: Number(r.historical_customers) || 0,
    lifetime_revenue: Number(r.lifetime_revenue) || 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top margin products — gold_product_performance aggregation
// ──────────────────────────────────────────────────────────────────────────
// Replaces product_margin_analysis (dropped SP1). Uses gold_product_performance
// which provides margin_pct_12m (true margin, not markup) and odoo_revenue_12m_mxn.
// Back-compat: keeps product_ref, product_name, weighted_margin_pct, weighted_markup_pct,
// total_revenue, customers fields used by /productos page.
export interface TopMarginProductRow {
  internal_ref: string | null;
  display_name: string | null;
  total_revenue_mxn: number;
  margin_pct_12m: number | null;
  units_sold_12m: number;
  unique_customers_12m: number;
  // Back-compat aliases (consumers rely on these)
  product_ref: string | null;
  product_name: string | null;
  total_revenue: number;
  weighted_margin_pct: number;
  weighted_markup_pct: number;
  customers: number;
  category: string | null;
}

export async function getTopMarginProducts(
  limit = 15
): Promise<TopMarginProductRow[]> {
  const sb = getServiceClient();
  // SP5-VERIFIED: gold_product_performance retained (§12 KEEP+rewire category)
  const { data, error } = await sb
    .from("gold_product_performance")
    .select(
      "internal_ref, display_name, category, odoo_revenue_12m_mxn, margin_pct_12m, units_sold_12m, unique_customers_12m"
    )
    .gt("odoo_revenue_12m_mxn", 0)
    .not("margin_pct_12m", "is", null)
    .order("odoo_revenue_12m_mxn", { ascending: false, nullsFirst: false })
    .limit(limit * 3); // over-fetch so caller can re-sort
  if (error) throw error;

  return ((data ?? []) as Array<{
    internal_ref: string | null;
    display_name: string | null;
    category: string | null;
    odoo_revenue_12m_mxn: number | null;
    margin_pct_12m: number | null;
    units_sold_12m: number | null;
    unique_customers_12m: number | null;
  }>)
    .map((r) => {
      const rev = Number(r.odoo_revenue_12m_mxn) || 0;
      const marginPct = r.margin_pct_12m != null ? Number(r.margin_pct_12m) : 0;
      // margin_pct_12m from gold view is already true margin (0-100).
      // Derive markup for back-compat: markup = margin / (1 - margin/100)
      const markupPct = marginPct < 100 ? (marginPct / (100 - marginPct)) * 100 : 0;
      return {
        internal_ref: r.internal_ref,
        display_name: r.display_name,
        category: r.category,
        total_revenue_mxn: rev,
        margin_pct_12m: r.margin_pct_12m != null ? Number(r.margin_pct_12m) : null,
        units_sold_12m: Number(r.units_sold_12m) || 0,
        unique_customers_12m: Number(r.unique_customers_12m) || 0,
        // Back-compat aliases
        product_ref: r.internal_ref,
        product_name: r.display_name,
        total_revenue: rev,
        weighted_margin_pct: marginPct,
        weighted_markup_pct: markupPct,
        customers: Number(r.unique_customers_12m) || 0,
      };
    })
    .sort((a, b) => b.total_revenue_mxn - a.total_revenue_mxn)
    .slice(0, limit);
}

// ──────────────────────────────────────────────────────────────────────────
// UoM mismatch — replaced product_margin_analysis reads with TODO SP6 stub
// ──────────────────────────────────────────────────────────────────────────
// product_margin_analysis was dropped in SP1. The has_uom_mismatch field and
// uom_mismatch_* fields do not exist in any canonical/gold table yet.
// TODO SP6: implement via canonical_order_lines JOIN canonical_products on uom comparison.
export interface UomMismatchRow {
  odoo_product_id: number | null;
  product_ref: string | null;
  product_name: string | null;
  product_uom: string | null;
  mismatch_order_lines: number;
  mismatch_invoice_lines: number;
  mismatch_revenue_mxn: number;
  total_revenue_mxn: number;
}

export async function getUomMismatchProducts(
  _limit = 30
): Promise<UomMismatchRow[]> {
  // TODO SP6: product_margin_analysis dropped SP1. Reimplement via
  // canonical_order_lines + canonical_products line_uom vs product uom comparison.
  return [];
}

// ──────────────────────────────────────────────────────────────────────────
// BOM real cost insights
// ──────────────────────────────────────────────────────────────────────────
//
// product_real_cost MV is on the KEEP list (§12). Preserved intact.
// getPmaRevenueMap was previously sourcing from product_margin_analysis (dropped
// SP1). Replaced with canonical_order_lines (sale) aggregation for revenue context.

export interface BomCostRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  component_count: number;
  distinct_raw_components: number;
  max_depth: number;
  missing_cost_components: number;
  has_missing_costs: boolean;
  has_multiple_boms: boolean;
  active_boms_for_product: number;
  bom_type: string | null;
  cached_standard_price: number;
  real_unit_cost: number;
  delta_vs_cached_pct: number | null;
  material_cost_total: number;
  bom_yield: number;
  revenue_12m: number;
  avg_order_price: number;
  qty_ordered_12m: number;
  impact_mxn: number;
}

export interface BomCostSummary {
  totalBoms: number;
  productsWithRealCost: number;
  productsWithMissingComponents: number;
  productsInSales: number;
  coverageOfSalesPct: number;
  medianDeltaPct: number | null;
  medianDeltaCompletePct: number | null;
  suspiciousBomsCount: number;
  revenueCoveredMxn: number;
  productsWithMultipleBoms: number;
  maxBomDepth: number;
  productsByDepth: { depth: number; count: number }[];
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 === 1
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Revenue map sourced from canonical_order_lines (sale) — replaces
 * product_margin_analysis which was dropped in SP1.
 */
async function getRevenueMapFromOrderLines(): Promise<
  Map<number, { revenue: number; avgPrice: number; qty: number }>
> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_order_lines")
    .select("odoo_product_id, subtotal_mxn, price_unit, qty")
    .eq("order_type", "sale")
    .not("odoo_product_id", "is", null);
  const rows = (data ?? []) as Array<{
    odoo_product_id: number | null;
    subtotal_mxn: number | null;
    price_unit: number | null;
    qty: number | null;
  }>;
  const map = new Map<
    number,
    { revenue: number; priceSum: number; qty: number; n: number }
  >();
  for (const r of rows) {
    if (!r.odoo_product_id) continue;
    const cur = map.get(r.odoo_product_id) ?? {
      revenue: 0,
      priceSum: 0,
      qty: 0,
      n: 0,
    };
    cur.revenue += Number(r.subtotal_mxn) || 0;
    cur.priceSum += Number(r.price_unit) || 0;
    cur.qty += Number(r.qty) || 0;
    cur.n += 1;
    map.set(r.odoo_product_id, cur);
  }
  const result = new Map<
    number,
    { revenue: number; avgPrice: number; qty: number }
  >();
  for (const [k, v] of map) {
    result.set(k, {
      revenue: v.revenue,
      avgPrice: v.n > 0 ? v.priceSum / v.n : 0,
      qty: v.qty,
    });
  }
  return result;
}

export async function getBomCostSummary(): Promise<BomCostSummary> {
  const sb = getServiceClient();
  const [boms, prc, orderLinesRevenue] = await Promise.all([
    sb
      .from("mrp_boms")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    sb // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
      .from("product_real_cost")
      .select(
        "odoo_product_id, has_missing_costs, has_multiple_boms, max_depth, delta_vs_cached_pct, real_unit_cost"
      ),
    // Replaces product_margin_analysis: revenue context from canonical_order_lines
    sb
      .from("canonical_order_lines")
      .select("odoo_product_id, subtotal_mxn")
      .eq("order_type", "sale")
      .not("odoo_product_id", "is", null),
  ]);

  const prcRows = (prc.data ?? []) as Array<{
    odoo_product_id: number;
    has_missing_costs: boolean;
    has_multiple_boms: boolean;
    max_depth: number;
    delta_vs_cached_pct: number | null;
    real_unit_cost: number | null;
  }>;

  const olRows = (orderLinesRevenue.data ?? []) as Array<{
    odoo_product_id: number | null;
    subtotal_mxn: number | null;
  }>;

  const bomProductIds = new Set(prcRows.map((r) => r.odoo_product_id));
  const saleProductRevenue = new Map<number, number>();
  for (const r of olRows) {
    if (!r.odoo_product_id) continue;
    saleProductRevenue.set(
      r.odoo_product_id,
      (saleProductRevenue.get(r.odoo_product_id) ?? 0) +
        (Number(r.subtotal_mxn) || 0)
    );
  }
  const productsInSales = saleProductRevenue.size;
  const overlap = [...saleProductRevenue.keys()].filter((id) =>
    bomProductIds.has(id)
  );
  const revenueCovered = overlap.reduce(
    (a, id) => a + (saleProductRevenue.get(id) ?? 0),
    0
  );

  const allDeltas = prcRows
    .map((r) => r.delta_vs_cached_pct)
    .filter((d): d is number => d != null);
  const completeDeltas = prcRows
    .filter((r) => !r.has_missing_costs)
    .map((r) => r.delta_vs_cached_pct)
    .filter((d): d is number => d != null);

  const depthBuckets = new Map<number, number>();
  let maxDepth = 0;
  for (const r of prcRows) {
    const d = r.max_depth ?? 0;
    if (d > maxDepth) maxDepth = d;
    depthBuckets.set(d, (depthBuckets.get(d) ?? 0) + 1);
  }
  const productsByDepth = [...depthBuckets.entries()]
    .map(([depth, count]) => ({ depth, count }))
    .sort((a, b) => a.depth - b.depth);

  return {
    totalBoms: boms.count ?? 0,
    productsWithRealCost: prcRows.filter((r) => (r.real_unit_cost ?? 0) > 0)
      .length,
    productsWithMissingComponents: prcRows.filter((r) => r.has_missing_costs)
      .length,
    productsInSales,
    coverageOfSalesPct:
      productsInSales === 0 ? 0 : (overlap.length / productsInSales) * 100,
    medianDeltaPct: median(allDeltas),
    medianDeltaCompletePct: median(completeDeltas),
    suspiciousBomsCount: prcRows.filter(
      (r) => (r.delta_vs_cached_pct ?? 0) > 50
    ).length,
    revenueCoveredMxn: revenueCovered,
    productsWithMultipleBoms: prcRows.filter((r) => r.has_multiple_boms)
      .length,
    maxBomDepth: maxDepth,
    productsByDepth,
  };
}

type RawPrcRow = {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  raw_components_count: number | null;
  distinct_raw_components: number | null;
  max_depth: number | null;
  missing_cost_components: number | null;
  has_missing_costs: boolean | null;
  has_multiple_boms: boolean | null;
  active_boms_for_product: number | null;
  bom_type: string | null;
  cached_standard_price: number | null;
  real_unit_cost: number | null;
  delta_vs_cached_pct: number | null;
  material_cost_total: number | null;
  bom_yield: number | null;
};

const PRC_SELECT =
  "odoo_product_id, product_ref, product_name, raw_components_count, distinct_raw_components, max_depth, missing_cost_components, has_missing_costs, has_multiple_boms, active_boms_for_product, bom_type, cached_standard_price, real_unit_cost, delta_vs_cached_pct, material_cost_total, bom_yield";

function mapPrcRow(
  r: RawPrcRow,
  pmaMap: Map<number, { revenue: number; avgPrice: number; qty: number }>
): BomCostRow {
  const pma = pmaMap.get(r.odoo_product_id) ?? {
    revenue: 0,
    avgPrice: 0,
    qty: 0,
  };
  const delta = r.delta_vs_cached_pct ?? 0;
  return {
    odoo_product_id: r.odoo_product_id,
    product_ref: r.product_ref,
    product_name: r.product_name,
    component_count: r.raw_components_count ?? 0,
    distinct_raw_components: r.distinct_raw_components ?? 0,
    max_depth: r.max_depth ?? 0,
    missing_cost_components: r.missing_cost_components ?? 0,
    has_missing_costs: r.has_missing_costs ?? false,
    has_multiple_boms: r.has_multiple_boms ?? false,
    active_boms_for_product: r.active_boms_for_product ?? 1,
    bom_type: r.bom_type,
    cached_standard_price: r.cached_standard_price ?? 0,
    real_unit_cost: r.real_unit_cost ?? 0,
    delta_vs_cached_pct: delta,
    material_cost_total: r.material_cost_total ?? 0,
    bom_yield: r.bom_yield ?? 1,
    revenue_12m: pma.revenue,
    avg_order_price: pma.avgPrice,
    qty_ordered_12m: pma.qty,
    impact_mxn: (Math.abs(delta) * pma.revenue) / 100,
  };
}

export async function getSuspiciousBoms(limit = 30): Promise<BomCostRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
    .from("product_real_cost")
    .select(PRC_SELECT)
    .gt("delta_vs_cached_pct", 50)
    .eq("has_missing_costs", false)
    .order("delta_vs_cached_pct", { ascending: false })
    .limit(limit);

  const pmaMap = await getRevenueMapFromOrderLines();
  return ((data ?? []) as RawPrcRow[]).map((r) => mapPrcRow(r, pmaMap));
}

export async function getBomsMissingComponents(
  limit = 30
): Promise<BomCostRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
    .from("product_real_cost")
    .select(PRC_SELECT)
    .eq("has_missing_costs", true)
    .order("missing_cost_components", { ascending: false })
    .limit(limit);

  const pmaMap = await getRevenueMapFromOrderLines();
  return ((data ?? []) as RawPrcRow[])
    .map((r) => mapPrcRow(r, pmaMap))
    .sort((a, b) => b.revenue_12m - a.revenue_12m);
}

export async function getTopRevenueBoms(limit = 30): Promise<BomCostRow[]> {
  const pmaMap = await getRevenueMapFromOrderLines();
  const topPrcIds = [...pmaMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 300)
    .map(([id]) => id);

  if (topPrcIds.length === 0) return [];

  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
    .from("product_real_cost")
    .select(PRC_SELECT)
    .in("odoo_product_id", topPrcIds);

  return ((data ?? []) as RawPrcRow[])
    .map((r) => mapPrcRow(r, pmaMap))
    .sort((a, b) => b.revenue_12m - a.revenue_12m)
    .slice(0, limit);
}

export interface BomDuplicateRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  intra_dupe_components: number;
  same_name_groups: number;
  intra_dupe_overcounted_mxn: number;
  same_name_overcounted_mxn: number;
  total_overcounted_per_unit_mxn: number;
  real_unit_cost: number;
  overcounted_pct_of_cost: number | null;
  revenue_12m: number;
  total_revenue_impact_mxn: number;
}

export async function getBomDuplicates(limit = 30): Promise<BomDuplicateRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("bom_duplicate_components")
    .select(
      "odoo_product_id, product_ref, product_name, intra_dupe_components, same_name_groups, intra_dupe_overcounted_mxn, same_name_overcounted_mxn, total_overcounted_per_unit_mxn"
    )
    .gt("total_overcounted_per_unit_mxn", 0)
    .order("total_overcounted_per_unit_mxn", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<{
    odoo_product_id: number;
    product_ref: string | null;
    product_name: string | null;
    intra_dupe_components: number;
    same_name_groups: number;
    intra_dupe_overcounted_mxn: number;
    same_name_overcounted_mxn: number;
    total_overcounted_per_unit_mxn: number;
  }>;

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.odoo_product_id);
  // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
  const [costRes, revRes] = await Promise.all([
    sb
      .from("product_real_cost")
      .select("odoo_product_id, real_unit_cost")
      .in("odoo_product_id", ids),
    // Replaces product_margin_analysis: use canonical_order_lines for revenue context
    sb
      .from("canonical_order_lines")
      .select("odoo_product_id, subtotal_mxn, qty")
      .eq("order_type", "sale")
      .in("odoo_product_id", ids),
  ]);

  const costMap = new Map<number, number>();
  for (const c of (costRes.data ?? []) as Array<{
    odoo_product_id: number;
    real_unit_cost: number | null;
  }>) {
    costMap.set(c.odoo_product_id, c.real_unit_cost ?? 0);
  }

  const revMap = new Map<number, { rev: number; qty: number }>();
  for (const p of (revRes.data ?? []) as Array<{
    odoo_product_id: number | null;
    subtotal_mxn: number | null;
    qty: number | null;
  }>) {
    if (!p.odoo_product_id) continue;
    const cur = revMap.get(p.odoo_product_id) ?? { rev: 0, qty: 0 };
    cur.rev += Number(p.subtotal_mxn) || 0;
    cur.qty += Number(p.qty) || 0;
    revMap.set(p.odoo_product_id, cur);
  }

  return rows.map((r) => {
    const cost = costMap.get(r.odoo_product_id) ?? 0;
    const ctx = revMap.get(r.odoo_product_id) ?? { rev: 0, qty: 0 };
    const pct =
      cost > 0 ? (r.total_overcounted_per_unit_mxn / cost) * 100 : null;
    return {
      odoo_product_id: r.odoo_product_id,
      product_ref: r.product_ref,
      product_name: r.product_name,
      intra_dupe_components: r.intra_dupe_components ?? 0,
      same_name_groups: r.same_name_groups ?? 0,
      intra_dupe_overcounted_mxn: r.intra_dupe_overcounted_mxn ?? 0,
      same_name_overcounted_mxn: r.same_name_overcounted_mxn ?? 0,
      total_overcounted_per_unit_mxn: r.total_overcounted_per_unit_mxn ?? 0,
      real_unit_cost: cost,
      overcounted_pct_of_cost: pct,
      revenue_12m: ctx.rev,
      total_revenue_impact_mxn: r.total_overcounted_per_unit_mxn * ctx.qty,
    };
  });
}

export async function getBomsWithMultipleVersions(
  limit = 30
): Promise<BomCostRow[]> {
  const sb = getServiceClient();
  const { data } = await sb // SP5-VERIFIED: product_real_cost retained (§12 KEEP)
    .from("product_real_cost")
    .select(PRC_SELECT)
    .eq("has_multiple_boms", true)
    .order("active_boms_for_product", { ascending: false })
    .limit(limit);

  const pmaMap = await getRevenueMapFromOrderLines();
  return ((data ?? []) as RawPrcRow[])
    .map((r) => mapPrcRow(r, pmaMap))
    .sort((a, b) => b.revenue_12m - a.revenue_12m);
}
