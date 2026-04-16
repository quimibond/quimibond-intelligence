import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { paginationRange, type TableParams } from "./table-params";

/**
 * Products queries v2 — usa views canónicas:
 * - `inventory_velocity` (view) — daily run rate, days of stock, reorder_status
 * - `dead_stock_analysis` (MV) — productos sin movimiento
 * - `product_margin_analysis` (MV) — margen por producto×cliente
 * - `odoo_products` (base) — catálogo
 * - `odoo_orderpoints` (base) — reglas de reorden
 */

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
  const [catalog, velocity, deadStock, margin] = await Promise.all([
    sb
      .from("odoo_products")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    sb
      .from("inventory_velocity")
      .select("reorder_status, stock_value"),
    sb.from("dead_stock_analysis").select("inventory_value"),
    sb.from("product_margin_analysis").select("gross_margin_pct"),
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

  const marginRows = (margin.data ?? []) as Array<{
    gross_margin_pct: number | null;
  }>;
  const validMargins = marginRows.filter(
    (r) => r.gross_margin_pct != null && Number(r.gross_margin_pct) > 0
  );
  const avgMarginPct =
    validMargins.length > 0
      ? validMargins.reduce(
          (a, r) => a + (Number(r.gross_margin_pct) || 0),
          0
        ) / validMargins.length
      : 0;

  return {
    catalogActive: catalog.count ?? 0,
    needsReorder,
    noMovementCount: noMovement.length,
    noMovementValue: noMovementValue,
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

export async function getReorderNeeded(
  limit = 50
): Promise<ReorderRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
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

  let query = sb
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
  const { data } = await sb
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

  let query = sb
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
  const { data } = await sb
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

  let query = sb
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
  const { data } = await sb
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
// Top markup products (aggregated por product across all customers)
// ──────────────────────────────────────────────────────────────────────────
// IMPORTANTE: `product_margin_analysis.gross_margin_pct` es MARKUP
// `(price-cost)/cost*100`, NO margen `(price-cost)/price*100`. Valores de
// 691%, 758% son válidos como markup (precio 7-8x el costo) pero se leen
// como "margen" incoherentes. Convertimos a margen real aquí antes de
// renderizar. Referencia: customer_margin_analysis sí computa margen real
// `SUM(line_margin)/SUM(line_revenue)*100` (0-100%), así que /ventas y
// /productos ahora son comparables.
export interface TopMarginProductRow {
  product_ref: string | null;
  product_name: string | null;
  total_revenue: number;
  weighted_margin_pct: number;
  weighted_markup_pct: number;
  customers: number;
}

/** Convierte markup a margen real: m% = markup% / (1 + markup%/100). */
function markupToMargin(markupPct: number): number {
  if (!Number.isFinite(markupPct)) return 0;
  return (markupPct / (100 + markupPct)) * 100;
}

export async function getTopMarginProducts(
  limit = 15
): Promise<TopMarginProductRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_margin_analysis")
    .select(
      "product_ref, product_name, gross_margin_pct, total_order_value, company_id"
    )
    .gt("total_order_value", 0)
    .not("gross_margin_pct", "is", null);
  const rows = (data ?? []) as Array<{
    product_ref: string | null;
    product_name: string | null;
    gross_margin_pct: number | null;
    total_order_value: number | null;
    company_id: number | null;
  }>;

  const byProduct = new Map<
    string,
    {
      product_ref: string | null;
      product_name: string | null;
      revenue_sum: number;
      markup_weighted: number;
      customers: Set<number>;
    }
  >();

  for (const r of rows) {
    const key = r.product_ref ?? r.product_name ?? "—";
    const entry =
      byProduct.get(key) ??
      {
        product_ref: r.product_ref,
        product_name: r.product_name,
        revenue_sum: 0,
        markup_weighted: 0,
        customers: new Set<number>(),
      };
    const rev = Number(r.total_order_value) || 0;
    const markup = Number(r.gross_margin_pct) || 0;
    entry.revenue_sum += rev;
    entry.markup_weighted += rev * markup;
    if (r.company_id) entry.customers.add(r.company_id);
    byProduct.set(key, entry);
  }

  return [...byProduct.values()]
    .map((v) => {
      const markup = v.revenue_sum > 0 ? v.markup_weighted / v.revenue_sum : 0;
      return {
        product_ref: v.product_ref,
        product_name: v.product_name,
        total_revenue: v.revenue_sum,
        weighted_markup_pct: markup,
        weighted_margin_pct: markupToMargin(markup),
        customers: v.customers.size,
      };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, limit);
}

// ──────────────────────────────────────────────────────────────────────────
// UoM mismatch (Sprint 13e)
// ──────────────────────────────────────────────────────────────────────────
//
// Surfaces products where some sale/invoice line was sold in a different
// UoM than the product's canonical UoM (e.g. CHIFON NEGRO 011 marked in
// meters but sold by kilos). The matview already excludes those lines
// from the qty / avg-price math; this query lists which products are
// affected so Production / Compras can clean up the Odoo data.

export interface UomMismatchRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  product_uom: string | null;
  mismatch_order_lines: number;
  mismatch_invoice_lines: number;
  mismatch_revenue_mxn: number;
  total_revenue_mxn: number;
}

export async function getUomMismatchProducts(
  limit = 30
): Promise<UomMismatchRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_margin_analysis")
    .select(
      "odoo_product_id, product_ref, product_name, total_order_value, uom_mismatch_order_lines, uom_mismatch_invoice_lines, uom_mismatch_revenue_mxn"
    )
    .eq("has_uom_mismatch", true);

  const rows = (data ?? []) as Array<{
    odoo_product_id: number;
    product_ref: string | null;
    product_name: string | null;
    total_order_value: number | null;
    uom_mismatch_order_lines: number | null;
    uom_mismatch_invoice_lines: number | null;
    uom_mismatch_revenue_mxn: number | null;
  }>;

  if (rows.length === 0) return [];

  // Roll up per product (matview is per product x company)
  const byProduct = new Map<
    number,
    {
      odoo_product_id: number;
      product_ref: string | null;
      product_name: string | null;
      orders: number;
      invoices: number;
      mismatch_rev: number;
      total_rev: number;
    }
  >();
  for (const r of rows) {
    const cur = byProduct.get(r.odoo_product_id) ?? {
      odoo_product_id: r.odoo_product_id,
      product_ref: r.product_ref,
      product_name: r.product_name,
      orders: 0,
      invoices: 0,
      mismatch_rev: 0,
      total_rev: 0,
    };
    cur.orders += r.uom_mismatch_order_lines ?? 0;
    cur.invoices += r.uom_mismatch_invoice_lines ?? 0;
    cur.mismatch_rev += r.uom_mismatch_revenue_mxn ?? 0;
    cur.total_rev += r.total_order_value ?? 0;
    byProduct.set(r.odoo_product_id, cur);
  }

  // Pull product UoM
  const ids = [...byProduct.keys()];
  const { data: prods } = await sb
    .from("odoo_products")
    .select("odoo_product_id, uom")
    .in("odoo_product_id", ids);
  const uomMap = new Map<number, string>();
  for (const p of (prods ?? []) as Array<{
    odoo_product_id: number;
    uom: string | null;
  }>) {
    uomMap.set(p.odoo_product_id, p.uom ?? "");
  }

  return [...byProduct.values()]
    .map((p) => ({
      odoo_product_id: p.odoo_product_id,
      product_ref: p.product_ref,
      product_name: p.product_name,
      product_uom: uomMap.get(p.odoo_product_id) ?? null,
      mismatch_order_lines: p.orders,
      mismatch_invoice_lines: p.invoices,
      mismatch_revenue_mxn: p.mismatch_rev,
      total_revenue_mxn: p.total_rev,
    }))
    .sort((a, b) => b.mismatch_revenue_mxn - a.mismatch_revenue_mxn)
    .slice(0, limit);
}

// ──────────────────────────────────────────────────────────────────────────
// BOM real cost insights (Sprint 13)
// ──────────────────────────────────────────────────────────────────────────
//
// Desde el 1-Abr-2026, los BOMs sólo contienen materia prima (sin mano de
// obra ni energéticos, que se incorporarán vía centros de trabajo).
// Por eso el real_unit_cost derivado de BOM es un LÍMITE INFERIOR del
// costo verdadero; la diferencia negativa contra standard_price NO es
// "descubrimiento de margen", es sólo la porción de costos aún no capturada.
//
// Usamos estas queries para identificar:
// 1. BOMs sospechosos (delta positivo grande → el BOM tiene cantidades mal
//    capturadas, porque nada debería costar MÁS que el standard histórico).
// 2. Productos con componentes sin costeo (has_missing_costs).
// 3. Impacto $ en revenue: productos con mayor volumen × delta.

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

export async function getBomCostSummary(): Promise<BomCostSummary> {
  const sb = getServiceClient();
  const [boms, prc, pmaProducts] = await Promise.all([
    sb.from("mrp_boms").select("id", { count: "exact", head: true }).eq("active", true),
    sb
      .from("product_real_cost")
      .select(
        "odoo_product_id, has_missing_costs, has_multiple_boms, max_depth, delta_vs_cached_pct, real_unit_cost"
      ),
    sb
      .from("product_margin_analysis")
      .select("odoo_product_id, total_order_value, cost_source"),
  ]);

  const prcRows = (prc.data ?? []) as Array<{
    odoo_product_id: number;
    has_missing_costs: boolean;
    has_multiple_boms: boolean;
    max_depth: number;
    delta_vs_cached_pct: number | null;
    real_unit_cost: number | null;
  }>;

  const pmaRows = (pmaProducts.data ?? []) as Array<{
    odoo_product_id: number;
    total_order_value: number | null;
    cost_source: string | null;
  }>;

  const bomProductIds = new Set(prcRows.map((r) => r.odoo_product_id));
  const saleProductRevenue = new Map<number, number>();
  for (const r of pmaRows) {
    if (r.odoo_product_id == null) continue;
    saleProductRevenue.set(
      r.odoo_product_id,
      (saleProductRevenue.get(r.odoo_product_id) ?? 0) +
        (r.total_order_value ?? 0)
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
    productsWithMultipleBoms: prcRows.filter((r) => r.has_multiple_boms).length,
    maxBomDepth: maxDepth,
    productsByDepth,
  };
}

async function getPmaRevenueMap(): Promise<
  Map<number, { revenue: number; avgPrice: number; qty: number }>
> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_margin_analysis")
    .select(
      "odoo_product_id, total_order_value, avg_order_price, total_qty_ordered"
    );
  const rows = (data ?? []) as Array<{
    odoo_product_id: number;
    total_order_value: number | null;
    avg_order_price: number | null;
    total_qty_ordered: number | null;
  }>;
  const map = new Map<
    number,
    { revenue: number; avgPrice: number; qty: number; n: number }
  >();
  for (const r of rows) {
    if (r.odoo_product_id == null) continue;
    const cur = map.get(r.odoo_product_id) ?? {
      revenue: 0,
      avgPrice: 0,
      qty: 0,
      n: 0,
    };
    cur.revenue += r.total_order_value ?? 0;
    cur.avgPrice += r.avg_order_price ?? 0;
    cur.qty += r.total_qty_ordered ?? 0;
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
      avgPrice: v.n > 0 ? v.avgPrice / v.n : 0,
      qty: v.qty,
    });
  }
  return result;
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
  // BOMs donde el costo recursivo derivado > standard_price histórico por
  // más de 50%. Con MO/energéticos removidos desde abr-2026, esto NO debería
  // pasar: casi siempre es captura errónea (qty, uom, componente equivocado).
  // EXCLUYE productos con missing_costs (que están subestimados artificialmente).
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_real_cost")
    .select(PRC_SELECT)
    .gt("delta_vs_cached_pct", 50)
    .eq("has_missing_costs", false)
    .order("delta_vs_cached_pct", { ascending: false })
    .limit(limit);

  const pmaMap = await getPmaRevenueMap();
  return ((data ?? []) as RawPrcRow[]).map((r) => mapPrcRow(r, pmaMap));
}

export async function getBomsMissingComponents(
  limit = 30
): Promise<BomCostRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_real_cost")
    .select(PRC_SELECT)
    .eq("has_missing_costs", true)
    .order("missing_cost_components", { ascending: false })
    .limit(limit);

  const pmaMap = await getPmaRevenueMap();
  return ((data ?? []) as RawPrcRow[])
    .map((r) => mapPrcRow(r, pmaMap))
    .sort((a, b) => b.revenue_12m - a.revenue_12m);
}

export async function getTopRevenueBoms(limit = 30): Promise<BomCostRow[]> {
  // Productos vendidos con BOM (overlap PMA ↔ PRC), ordenados por revenue.
  const pmaMap = await getPmaRevenueMap();
  const topPmaIds = [...pmaMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 300)
    .map(([id]) => id);

  if (topPmaIds.length === 0) return [];

  const sb = getServiceClient();
  const { data } = await sb
    .from("product_real_cost")
    .select(PRC_SELECT)
    .in("odoo_product_id", topPmaIds);

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
  // estimate of total $ overcounted across all sales of this product
  // = total_overcounted_per_unit * total_qty_ordered (in product UoM)
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

  // Pull cost + revenue context for the same products
  const ids = rows.map((r) => r.odoo_product_id);
  const [costRes, pmaRes] = await Promise.all([
    sb
      .from("product_real_cost")
      .select("odoo_product_id, real_unit_cost")
      .in("odoo_product_id", ids),
    sb
      .from("product_margin_analysis")
      .select("odoo_product_id, total_order_value, total_qty_ordered")
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
  for (const p of (pmaRes.data ?? []) as Array<{
    odoo_product_id: number;
    total_order_value: number | null;
    total_qty_ordered: number | null;
  }>) {
    const cur = revMap.get(p.odoo_product_id) ?? { rev: 0, qty: 0 };
    cur.rev += p.total_order_value ?? 0;
    cur.qty += p.total_qty_ordered ?? 0;
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
  // Productos con múltiples BOMs activos. El matview eligió el más reciente
  // (highest odoo_bom_id). Útil para que Producción consolide o desactive
  // los BOMs viejos que ya no aplican.
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_real_cost")
    .select(PRC_SELECT)
    .eq("has_multiple_boms", true)
    .order("active_boms_for_product", { ascending: false })
    .limit(limit);

  const pmaMap = await getPmaRevenueMap();
  return ((data ?? []) as RawPrcRow[])
    .map((r) => mapPrcRow(r, pmaMap))
    .sort((a, b) => b.revenue_12m - a.revenue_12m);
}
