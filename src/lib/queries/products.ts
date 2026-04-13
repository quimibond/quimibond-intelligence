import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface ProductRow {
  id: number | string;
  internal_ref: string | null;
  name: string | null;
  stock_qty: number | null;
  reserved_qty: number | null;
  available_qty: number | null;
  standard_price: number | null;
  list_price: number | null;
}

export async function getProducts(limit = 100): Promise<ProductRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_products")
    .select(
      "id, internal_ref, name, stock_qty, reserved_qty, available_qty, standard_price, list_price"
    )
    .order("stock_qty", { ascending: false })
    .limit(limit);
  return (data ?? []) as ProductRow[];
}

export interface DeadStockRow {
  product_ref: string | null;
  product_name: string | null;
  stock_value_mxn: number | null;
  days_without_sale: number | null;
  stock_qty: number | null;
}

export async function getDeadStock(limit = 20): Promise<DeadStockRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("dead_stock_analysis")
    .select(
      "product_ref, product_name, stock_value_mxn, days_without_sale, stock_qty"
    )
    .order("stock_value_mxn", { ascending: false })
    .limit(limit);
  return (data ?? []) as DeadStockRow[];
}

export interface ProductsKpis {
  catalogCount: number;
  outOfStockCount: number;
  deadStockValue: number;
  lowStockCount: number;
}

export async function getProductsKpis(): Promise<ProductsKpis> {
  const sb = getServiceClient();
  const [catalog, outStock, deadStockAgg, lowStock] = await Promise.all([
    sb.from("odoo_products").select("id", { count: "exact", head: true }),
    sb
      .from("odoo_products")
      .select("id", { count: "exact", head: true })
      .lte("available_qty", 0),
    sb.from("dead_stock_analysis").select("stock_value_mxn"),
    sb
      .from("odoo_orderpoints")
      .select("id", { count: "exact", head: true }),
  ]);
  const deadValue = ((deadStockAgg.data ?? []) as Array<{
    stock_value_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.stock_value_mxn) || 0), 0);
  return {
    catalogCount: catalog.count ?? 0,
    outOfStockCount: outStock.count ?? 0,
    deadStockValue: deadValue,
    lowStockCount: lowStock.count ?? 0,
  };
}
