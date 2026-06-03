import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * Reconstrucción de costo total por producto (absorption costing "por fuera").
 *
 * Metodología (pedido CEO 2026-06-03):
 *  1. Costo primo MP por producto con ÚLTIMO costo de compra (no avg).
 *  2. Factor $/metro = gastos del mes ÷ metros de referencia producidos
 *     (OP-ACA + OP-V10). Dos factores: fabricación y operación.
 *  3. Costo reconstruido unitario = primo + factor_fab + factor_op.
 *  4. % de MP / fabricación / operación por producto y total.
 *  5. Comparación metros fabricados (referencia) vs metros vendidos.
 *
 * RPCs: get_full_cost_reconstruction, get_cost_factors_monthly,
 * get_meters_produced_vs_sold (migration 20260603).
 */

export interface CostReconRow {
  productId: number;
  productRef: string | null;
  productName: string | null;
  uom: string | null;
  qtySold: number;
  revenueMxn: number;
  costoPrimoUnitMxn: number;
  factorFabUnitMxn: number;
  factorOpUnitMxn: number;
  costoTotalUnitMxn: number;
  costoPrimoTotalMxn: number;
  gastosFabTotalMxn: number;
  gastosOpTotalMxn: number;
  costoTotalMxn: number;
  pctMp: number | null;
  pctFab: number | null;
  pctOp: number | null;
  marginFullPct: number | null;
  mpSource: string;
}

export interface CostReconTotals {
  productos: number;
  mpTotalMxn: number;
  fabTotalMxn: number;
  opTotalMxn: number;
  costoTotalMxn: number;
  revenueMxn: number;
  pctMp: number | null;
  pctFab: number | null;
  pctOp: number | null;
  marginPct: number | null;
}

export interface CostFactors {
  metrosReferencia: number;
  gastosFabMxn: number;
  gastosOpMxn: number;
  factorFabXMetro: number | null;
  factorOpXMetro: number | null;
  factorTotalXMetro: number | null;
}

export interface MetersProducedVsSold {
  mes: string;
  metrosOpAca: number;
  metrosOpV10: number;
  metrosReferencia: number;
  metrosVendidos: number;
  kgVendidos: number;
  ratioVendidoProducido: number | null;
}

export interface CostReconSnapshot {
  period: string;
  rangeLabel: string;
  factors: CostFactors | null;
  rows: CostReconRow[];
  totals: CostReconTotals;
  metersHistory: MetersProducedVsSold[];
}

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function nOrNull(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

async function _getCostReconSnapshotRaw(
  range: HistoryRange,
): Promise<CostReconSnapshot> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const period = bounds.toMonth;

  const [reconRes, factorsRes, metersRes] = await Promise.all([
    sb.rpc("get_full_cost_reconstruction", { p_period: period }),
    sb.rpc("get_cost_factors_monthly", { p_months_back: 36 }),
    sb.rpc("get_meters_produced_vs_sold", { p_months_back: 12 }),
  ]);

  const rows: CostReconRow[] = (
    (reconRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    productId: n(r.odoo_product_id),
    productRef: (r.product_ref as string) ?? null,
    productName: (r.product_name as string) ?? null,
    uom: (r.uom as string) ?? null,
    qtySold: n(r.qty_sold),
    revenueMxn: n(r.revenue_mxn),
    costoPrimoUnitMxn: n(r.costo_primo_unit_mxn),
    factorFabUnitMxn: n(r.factor_fab_unit_mxn),
    factorOpUnitMxn: n(r.factor_op_unit_mxn),
    costoTotalUnitMxn: n(r.costo_total_unit_mxn),
    costoPrimoTotalMxn: n(r.costo_primo_total_mxn),
    gastosFabTotalMxn: n(r.gastos_fab_total_mxn),
    gastosOpTotalMxn: n(r.gastos_op_total_mxn),
    costoTotalMxn: n(r.costo_total_mxn),
    pctMp: nOrNull(r.pct_mp),
    pctFab: nOrNull(r.pct_fab),
    pctOp: nOrNull(r.pct_op),
    marginFullPct: nOrNull(r.margin_full_pct),
    mpSource: (r.mp_source as string) ?? "—",
  }));

  rows.sort((a, b) => b.costoTotalMxn - a.costoTotalMxn);

  // Factores del período seleccionado
  const factorRows = (factorsRes.data ?? []) as Record<string, unknown>[];
  const fRow = factorRows.find((f) => f.mes === period);
  const factors: CostFactors | null = fRow
    ? {
        metrosReferencia: n(fRow.metros_referencia),
        gastosFabMxn: n(fRow.gastos_fabricacion_mxn),
        gastosOpMxn: n(fRow.gastos_operacion_mxn),
        factorFabXMetro: nOrNull(fRow.factor_fab_x_metro),
        factorOpXMetro: nOrNull(fRow.factor_op_x_metro),
        factorTotalXMetro: nOrNull(fRow.factor_total_x_metro),
      }
    : null;

  // Totales
  const totals = rows.reduce<CostReconTotals>(
    (acc, r) => {
      acc.mpTotalMxn += r.costoPrimoTotalMxn;
      acc.fabTotalMxn += r.gastosFabTotalMxn;
      acc.opTotalMxn += r.gastosOpTotalMxn;
      acc.costoTotalMxn += r.costoTotalMxn;
      acc.revenueMxn += r.revenueMxn;
      acc.productos += 1;
      return acc;
    },
    {
      productos: 0,
      mpTotalMxn: 0,
      fabTotalMxn: 0,
      opTotalMxn: 0,
      costoTotalMxn: 0,
      revenueMxn: 0,
      pctMp: null,
      pctFab: null,
      pctOp: null,
      marginPct: null,
    },
  );
  if (totals.costoTotalMxn > 0) {
    totals.pctMp = (totals.mpTotalMxn / totals.costoTotalMxn) * 100;
    totals.pctFab = (totals.fabTotalMxn / totals.costoTotalMxn) * 100;
    totals.pctOp = (totals.opTotalMxn / totals.costoTotalMxn) * 100;
  }
  if (totals.revenueMxn > 0) {
    totals.marginPct =
      ((totals.revenueMxn - totals.costoTotalMxn) / totals.revenueMxn) * 100;
  }

  const metersHistory: MetersProducedVsSold[] = (
    (metersRes.data ?? []) as Record<string, unknown>[]
  )
    .filter((m) => n(m.metros_referencia) > 0 || n(m.metros_vendidos) > 0)
    .map((m) => ({
      mes: m.mes as string,
      metrosOpAca: n(m.metros_op_aca),
      metrosOpV10: n(m.metros_op_v10),
      metrosReferencia: n(m.metros_referencia),
      metrosVendidos: n(m.metros_vendidos),
      kgVendidos: n(m.kg_vendidos),
      ratioVendidoProducido: nOrNull(m.ratio_vendido_producido),
    }));

  return {
    period,
    rangeLabel: bounds.label,
    factors,
    rows,
    totals,
    metersHistory,
  };
}

export const getCostReconSnapshot = (range: HistoryRange) =>
  unstable_cache(
    () => _getCostReconSnapshotRaw(range),
    ["sp13-cost-reconstruction-v1", String(range)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
