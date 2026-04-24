import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-MP-Q — Calidad de costo primo y desglose por producto.
 *
 * Tres RPCs subyacentes:
 *  - get_mp_leaves_inventory(): inventario de hojas (MP = componentes sin
 *    BOM propia). Retorna avg_cost, última compra, flag de calidad.
 *  - get_bom_composition(product_id): explosión recursiva de un producto
 *    final, cada hoja con qty/u, costo unitario y contribución al total.
 *  - get_cogs_per_product(from, to): ya existe — ventas + costo primo
 *    agregado por producto.
 *
 * Calidad de datos encontrada (2026-04):
 *  316 MP totales · 47 ok · 99 sin_avg_cost (31%) · 94 sin compra histórica
 *  · 63 compra >6m · 12 compra 3-6m · 1 desvío >25%.
 *
 * AGUA (usada en 385 BOMs sin costo): consumible cuyo gasto real está en
 * 504.01.0004 AGUA como gasto directo. No se costea por unidad producida.
 */

export type MpFlag =
  | "ok"
  | "sin_avg_cost"
  | "sin_compra_historica"
  | "compra_vieja_3m"
  | "compra_vieja_6m"
  | "desvio_25pct_vs_ultima";

export interface MpLeafRow {
  productId: number;
  productRef: string | null;
  productName: string | null;
  category: string | null;
  uom: string | null;
  avgCostMxn: number | null;
  standardPriceMxn: number | null;
  timesUsedInBoms: number;
  lastPurchaseDate: string | null;
  lastPurchasePrice: number | null;
  lastPurchaseQty: number | null;
  lastPurchaseCurrency: string | null;
  avgCostVsLastPct: number | null;
  daysSincePurchase: number | null;
  flag: MpFlag | string;
}

export interface MpLeavesInventory {
  rows: MpLeafRow[];
  flagCounts: Record<string, number>;
  totalLeaves: number;
}

type LeafRpcRow = {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  category: string | null;
  uom: string | null;
  avg_cost_mxn: number | string | null;
  standard_price_mxn: number | string | null;
  times_used_in_boms: number | string;
  last_purchase_date: string | null;
  last_purchase_price: number | string | null;
  last_purchase_qty: number | string | null;
  last_purchase_currency: string | null;
  avg_cost_vs_last_pct: number | string | null;
  days_since_purchase: number | null;
  flag: string;
};

async function _getMpLeavesInventoryRaw(): Promise<MpLeavesInventory> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_mp_leaves_inventory");
  if (error) {
    console.error("[getMpLeavesInventory] rpc failed", error.message);
    return { rows: [], flagCounts: {}, totalLeaves: 0 };
  }
  const rows: MpLeafRow[] = ((data ?? []) as LeafRpcRow[]).map((r) => ({
    productId: Number(r.odoo_product_id),
    productRef: r.product_ref,
    productName: r.product_name,
    category: r.category,
    uom: r.uom,
    avgCostMxn: r.avg_cost_mxn == null ? null : Number(r.avg_cost_mxn),
    standardPriceMxn:
      r.standard_price_mxn == null ? null : Number(r.standard_price_mxn),
    timesUsedInBoms: Number(r.times_used_in_boms) || 0,
    lastPurchaseDate: r.last_purchase_date,
    lastPurchasePrice:
      r.last_purchase_price == null ? null : Number(r.last_purchase_price),
    lastPurchaseQty:
      r.last_purchase_qty == null ? null : Number(r.last_purchase_qty),
    lastPurchaseCurrency: r.last_purchase_currency,
    avgCostVsLastPct:
      r.avg_cost_vs_last_pct == null ? null : Number(r.avg_cost_vs_last_pct),
    daysSincePurchase: r.days_since_purchase,
    flag: r.flag,
  }));
  const flagCounts: Record<string, number> = {};
  for (const r of rows) flagCounts[r.flag] = (flagCounts[r.flag] ?? 0) + 1;
  return { rows, flagCounts, totalLeaves: rows.length };
}

export const getMpLeavesInventory = unstable_cache(
  _getMpLeavesInventoryRaw,
  ["sp13-finanzas-mp-leaves"],
  { revalidate: 300, tags: ["finanzas"] }
);

/* ───────────────────────────────────────────────────────────────────── */

export interface BomCompositionLeaf {
  leafProductId: number;
  leafRef: string | null;
  leafName: string | null;
  qtyPerUnit: number;
  avgCostMxn: number | null;
  costContributionMxn: number;
  pctOfTotal: number;
  depth: number;
  path: string;
  hasCost: boolean;
}

export interface BomCompositionResult {
  productId: number;
  leaves: BomCompositionLeaf[];
  totalCostMxn: number;
  leavesWithoutCost: number;
}

type CompRpcRow = {
  leaf_product_id: number;
  leaf_ref: string | null;
  leaf_name: string | null;
  qty_per_unit: number | string;
  avg_cost_mxn: number | string | null;
  cost_contribution_mxn: number | string;
  pct_of_total: number | string;
  depth: number;
  path: string;
  has_cost: boolean;
};

export async function getBomComposition(
  productId: number
): Promise<BomCompositionResult> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_bom_composition", {
    p_product_id: productId,
  });
  if (error) {
    console.error(
      `[getBomComposition] rpc failed for product ${productId}`,
      error.message
    );
    return { productId, leaves: [], totalCostMxn: 0, leavesWithoutCost: 0 };
  }
  const leaves: BomCompositionLeaf[] = ((data ?? []) as CompRpcRow[]).map(
    (r) => ({
      leafProductId: Number(r.leaf_product_id),
      leafRef: r.leaf_ref,
      leafName: r.leaf_name,
      qtyPerUnit: Number(r.qty_per_unit),
      avgCostMxn: r.avg_cost_mxn == null ? null : Number(r.avg_cost_mxn),
      costContributionMxn: Number(r.cost_contribution_mxn) || 0,
      pctOfTotal: Number(r.pct_of_total) || 0,
      depth: Number(r.depth),
      path: r.path,
      hasCost: Boolean(r.has_cost),
    })
  );
  const totalCostMxn = leaves.reduce((s, l) => s + l.costContributionMxn, 0);
  const leavesWithoutCost = leaves.filter((l) => !l.hasCost).length;
  return {
    productId,
    leaves,
    totalCostMxn: Math.round(totalCostMxn * 10000) / 10000,
    leavesWithoutCost,
  };
}

/* ───────────────────────────────────────────────────────────────────── */

export interface TopProductWithComposition {
  productId: number;
  productRef: string | null;
  productName: string | null;
  qtySold: number;
  revenueInvoiceMxn: number;
  cogsRecursiveUnitMxn: number;
  cogsRecursiveTotalMxn: number;
  marginPct: number | null;
  flags: string[];
  composition: BomCompositionLeaf[];
  leavesWithoutCostInBom: number;
}

export interface TopProductsSummary {
  period: HistoryRange;
  periodLabel: string;
  rows: TopProductWithComposition[];
  totalRevenueMxn: number;
  totalCogsRecursiveMxn: number;
}

async function _getTopProductsWithCompositionRaw(
  range: HistoryRange,
  limit = 20
): Promise<TopProductsSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const { data, error } = await sb.rpc("get_cogs_per_product", {
    p_date_from: bounds.from,
    p_date_to: bounds.to,
  });
  if (error) {
    console.error(
      "[getTopProductsWithComposition] cogs_per_product failed",
      error.message
    );
    return {
      period: range,
      periodLabel: bounds.label,
      rows: [],
      totalRevenueMxn: 0,
      totalCogsRecursiveMxn: 0,
    };
  }
  type Row = {
    odoo_product_id: number;
    product_ref: string | null;
    product_name: string | null;
    qty_sold: number | string;
    revenue_invoice_mxn: number | string;
    cogs_recursive_unit_mxn: number | string;
    cogs_recursive_total_mxn: number | string;
    margin_pct: number | string | null;
    flags: string[] | null;
  };
  const all = (data ?? []) as Row[];
  // Filter: exclude machine / assets without ref
  const filtered = all.filter(
    (p) =>
      p.product_ref &&
      Number(p.revenue_invoice_mxn) > 0 &&
      Number(p.qty_sold) > 0
  );
  filtered.sort(
    (a, b) => Number(b.revenue_invoice_mxn) - Number(a.revenue_invoice_mxn)
  );
  const top = filtered.slice(0, limit);

  // Fetch composition for each top product in parallel
  const compositions = await Promise.all(
    top.map((p) => getBomComposition(p.odoo_product_id))
  );

  const rows: TopProductWithComposition[] = top.map((p, i) => {
    const comp = compositions[i];
    return {
      productId: Number(p.odoo_product_id),
      productRef: p.product_ref,
      productName: p.product_name,
      qtySold: Number(p.qty_sold) || 0,
      revenueInvoiceMxn: Number(p.revenue_invoice_mxn) || 0,
      cogsRecursiveUnitMxn: Number(p.cogs_recursive_unit_mxn) || 0,
      cogsRecursiveTotalMxn: Number(p.cogs_recursive_total_mxn) || 0,
      marginPct: p.margin_pct == null ? null : Number(p.margin_pct),
      flags: p.flags ?? [],
      composition: comp.leaves,
      leavesWithoutCostInBom: comp.leavesWithoutCost,
    };
  });

  const totalRevenueMxn = rows.reduce((s, r) => s + r.revenueInvoiceMxn, 0);
  const totalCogsRecursiveMxn = rows.reduce(
    (s, r) => s + r.cogsRecursiveTotalMxn,
    0
  );

  return {
    period: range,
    periodLabel: bounds.label,
    rows,
    totalRevenueMxn: Math.round(totalRevenueMxn * 100) / 100,
    totalCogsRecursiveMxn: Math.round(totalCogsRecursiveMxn * 100) / 100,
  };
}

export const getTopProductsWithComposition = (
  range: HistoryRange,
  limit = 20
) =>
  unstable_cache(
    () => _getTopProductsWithCompositionRaw(range, limit),
    ["sp13-finanzas-top-products-composition", range, String(limit)],
    { revalidate: 300, tags: ["finanzas"] }
  )();
