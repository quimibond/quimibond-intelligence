import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-COGS per producto — desglose de ventas y costo recursivo por SKU.
 *
 * RPC: `get_cogs_per_product(p_date_from, p_date_to)` retorna:
 *  - qty_sold: sumado con DISTINCT ON (move, product, quantity) para quitar
 *    la triplete IEPS (3 líneas por venta con la misma qty).
 *  - revenue_invoice_mxn: SUM de TODAS las líneas sin dedupe. La triplete
 *    se cancela aritméticamente (lista + descuento + neta → neta), así que
 *    sumar las 3 da exactamente la neta. Deduplicar acá tomaría la línea
 *    equivocada y generaba ingresos negativos falsos (-$11M en pruebas).
 *  - cogs_recursive_unit_mxn: explosión BOM recursiva hasta materia prima
 *    por producto (una BOM primaria por SKU, con avg_cost_mxn de hojas).
 *  - flags[]: quality flags para auditoría ('sin_bom', 'costo_cero',
 *    'costo_mayor_a_venta', 'margen_negativo', 'sin_costo_promedio').
 *
 * Nota: el revenue aquí es el facturado de la línea (base invoice). Para
 * el total consolidado del período usamos canonical_account_balances cuenta
 * 4xx (que excluye venta de activo fijo 7xx). En marzo 2026 la factura
 * incluye $11.35M de una máquina vendida cuyo P&L solo reconoce el gain
 * en 7xx ($574k) — esa diferencia aparece como `sin_ref` sin BOM.
 */
export interface CogsPerProductRow {
  productId: number;
  productRef: string | null;
  productName: string | null;
  qtySold: number;
  revenueInvoiceMxn: number;
  cogsRecursiveUnitMxn: number;
  cogsRecursiveTotalMxn: number;
  avgCostMxn: number | null;
  hasBom: boolean;
  marginPct: number | null;
  marginMxn: number;
  flags: string[];
}

export interface CogsPerProductSummary {
  period: HistoryRange;
  periodLabel: string;
  rows: CogsPerProductRow[];
  totalRevenueInvoiceMxn: number;
  totalCogsRecursiveMxn: number;
  flagCounts: Record<string, number>;
}

type RpcRow = {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  qty_sold: number | string;
  revenue_invoice_mxn: number | string;
  cogs_recursive_unit_mxn: number | string;
  cogs_recursive_total_mxn: number | string;
  avg_cost_mxn: number | string | null;
  has_bom: boolean;
  margin_pct: number | string | null;
  margin_mxn: number | string;
  flags: string[] | null;
};

async function _getCogsPerProductRaw(
  range: HistoryRange
): Promise<CogsPerProductSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const { data, error } = await sb.rpc("get_cogs_per_product", {
    p_date_from: bounds.from,
    p_date_to: bounds.to,
  });
  if (error) {
    console.error("[getCogsPerProduct] rpc failed", error.message);
    return {
      period: range,
      periodLabel: bounds.label,
      rows: [],
      totalRevenueInvoiceMxn: 0,
      totalCogsRecursiveMxn: 0,
      flagCounts: {},
    };
  }
  const rows: CogsPerProductRow[] = ((data ?? []) as RpcRow[]).map((r) => ({
    productId: Number(r.odoo_product_id),
    productRef: r.product_ref,
    productName: r.product_name,
    qtySold: Number(r.qty_sold) || 0,
    revenueInvoiceMxn: Number(r.revenue_invoice_mxn) || 0,
    cogsRecursiveUnitMxn: Number(r.cogs_recursive_unit_mxn) || 0,
    cogsRecursiveTotalMxn: Number(r.cogs_recursive_total_mxn) || 0,
    avgCostMxn: r.avg_cost_mxn == null ? null : Number(r.avg_cost_mxn),
    hasBom: Boolean(r.has_bom),
    marginPct: r.margin_pct == null ? null : Number(r.margin_pct),
    marginMxn: Number(r.margin_mxn) || 0,
    flags: r.flags ?? [],
  }));
  const totalRevenueInvoiceMxn = rows.reduce((s, r) => s + r.revenueInvoiceMxn, 0);
  const totalCogsRecursiveMxn = rows.reduce(
    (s, r) => s + r.cogsRecursiveTotalMxn,
    0
  );
  const flagCounts: Record<string, number> = {};
  for (const r of rows) {
    for (const f of r.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  }
  return {
    period: range,
    periodLabel: bounds.label,
    rows,
    totalRevenueInvoiceMxn: Math.round(totalRevenueInvoiceMxn * 100) / 100,
    totalCogsRecursiveMxn: Math.round(totalCogsRecursiveMxn * 100) / 100,
    flagCounts,
  };
}

export async function getCogsPerProduct(
  range: HistoryRange
): Promise<CogsPerProductSummary> {
  return _getCogsPerProductRaw(range);
}

export const getCogsPerProductCached = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsPerProductRaw(range),
    ["sp13-finanzas-cogs-per-product", range],
    { revalidate: 60, tags: ["finanzas"] }
  )();
