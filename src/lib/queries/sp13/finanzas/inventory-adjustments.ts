import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * Drilldown del residual P&L limpio (categoría `ajuste_inventario_year_end`
 * en pnl-normalized).
 *
 * Source: RPC `get_inventory_adjustments(p_from, p_to)` sobre canonical_stock_moves.
 * Decompone movimientos por categoría derivada de location_usage pair:
 *   compra            supplier  → internal
 *   venta             internal  → customer
 *   consumo_mp        internal  → production
 *   produccion_pt     production → internal
 *   transfer_interno  internal  → internal
 *   ajuste_inventario inventory ↔ internal
 *   devolucion_compra internal  → supplier
 *   devolucion_venta  customer  → internal
 *   otro              else
 *
 * Caso de uso: explicar el +$10.54M dec-2025 en 501.01.02. canonical_stock_moves
 * muestra 21,645 ajustes sobre 1,347 productos por $14.09M ese mes — antes era
 * caja negra. Ver migration 20260427_canonical_stock_moves.sql.
 */

export type InventoryMoveCategory =
  | "compra"
  | "venta"
  | "consumo_mp"
  | "produccion_pt"
  | "transfer_interno"
  | "ajuste_inventario"
  | "devolucion_compra"
  | "devolucion_venta"
  | "otro";

export interface InventoryAdjustmentRow {
  period: string; // YYYY-MM
  periodDate: string; // YYYY-MM-01
  category: InventoryMoveCategory;
  categoryLabel: string;
  movesCount: number;
  distinctProducts: number;
  qtyTotal: number;
  valueTotalMxn: number;
  valuePositiveMxn: number;
  valueNegativeMxn: number;
  origins: string[];
}

export interface InventoryAdjustmentsSummary {
  range: HistoryRange;
  periodLabel: string;
  rows: InventoryAdjustmentRow[];
  /** Total `ajuste_inventario` only (drilldown del residual). */
  totalAdjustmentMxn: number;
  /** Suma de TODOS los movimientos en value_total. */
  totalAllMovesMxn: number;
  /** Periodo con mayor ajuste_inventario absoluto. */
  hottestPeriod: { period: string; valueMxn: number } | null;
}

const CATEGORY_LABELS: Record<InventoryMoveCategory, string> = {
  compra: "Compra (proveedor → almacén)",
  venta: "Venta (almacén → cliente)",
  consumo_mp: "Consumo MP (almacén → producción)",
  produccion_pt: "Producción PT (producción → almacén)",
  transfer_interno: "Transfer interno (almacén ↔ almacén)",
  ajuste_inventario: "Ajuste de inventario (inv ↔ almacén)",
  devolucion_compra: "Devolución a proveedor",
  devolucion_venta: "Devolución de cliente",
  otro: "Otro",
};

type RpcRow = {
  period: string;
  period_date: string;
  move_category: string;
  moves_count: number | string | null;
  distinct_products: number | string | null;
  qty_total: number | string | null;
  value_total_mxn: number | string | null;
  value_positive_mxn: number | string | null;
  value_negative_mxn: number | string | null;
  origins: string[] | null;
};

async function _getInventoryAdjustmentsRaw(
  range: HistoryRange
): Promise<InventoryAdjustmentsSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const { data, error } = await sb.rpc("get_inventory_adjustments", {
    p_date_from: bounds.from,
    p_date_to: bounds.to,
  });
  if (error) {
    console.error("[getInventoryAdjustments] RPC failure", error.message);
    return {
      range,
      periodLabel: bounds.label,
      rows: [],
      totalAdjustmentMxn: 0,
      totalAllMovesMxn: 0,
      hottestPeriod: null,
    };
  }

  const rows: InventoryAdjustmentRow[] = ((data ?? []) as RpcRow[]).map((r) => {
    const cat = (r.move_category ?? "otro") as InventoryMoveCategory;
    return {
      period: r.period,
      periodDate: r.period_date,
      category: cat,
      categoryLabel: CATEGORY_LABELS[cat] ?? r.move_category,
      movesCount: Number(r.moves_count) || 0,
      distinctProducts: Number(r.distinct_products) || 0,
      qtyTotal: Number(r.qty_total) || 0,
      valueTotalMxn: Number(r.value_total_mxn) || 0,
      valuePositiveMxn: Number(r.value_positive_mxn) || 0,
      valueNegativeMxn: Number(r.value_negative_mxn) || 0,
      origins: r.origins ?? [],
    };
  });

  let totalAdjustmentMxn = 0;
  let totalAllMovesMxn = 0;
  const adjByPeriod = new Map<string, number>();
  for (const r of rows) {
    totalAllMovesMxn += r.valueTotalMxn;
    if (r.category === "ajuste_inventario") {
      totalAdjustmentMxn += r.valueTotalMxn;
      adjByPeriod.set(r.period, (adjByPeriod.get(r.period) ?? 0) + r.valueTotalMxn);
    }
  }
  let hottestPeriod: { period: string; valueMxn: number } | null = null;
  for (const [period, valueMxn] of adjByPeriod) {
    if (!hottestPeriod || Math.abs(valueMxn) > Math.abs(hottestPeriod.valueMxn)) {
      hottestPeriod = { period, valueMxn };
    }
  }

  return {
    range,
    periodLabel: bounds.label,
    rows,
    totalAdjustmentMxn: Math.round(totalAdjustmentMxn * 100) / 100,
    totalAllMovesMxn: Math.round(totalAllMovesMxn * 100) / 100,
    hottestPeriod,
  };
}

export const getInventoryAdjustments = (range: HistoryRange) =>
  unstable_cache(
    () => _getInventoryAdjustmentsRaw(range),
    ["sp13-finanzas-inventory-adjustments-v1", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
