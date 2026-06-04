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
  /** MP a costo PROMEDIO (avg_cost) — comparativo vs último costo. */
  costoPrimoAvgUnitMxn: number;
  costoPrimoAvgTotalMxn: number;
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
  /** Cada capa como % de las VENTAS del producto (lo que pidió el CEO). */
  pctMpVsRevenue: number | null;
  pctFabVsRevenue: number | null;
  pctOpVsRevenue: number | null;
  marginFullPct: number | null;
  mpSource: string;
}

export interface CostReconTotals {
  productos: number;
  mpTotalMxn: number;
  mpAvgTotalMxn: number;
  fabTotalMxn: number;
  opTotalMxn: number;
  costoTotalMxn: number;
  revenueMxn: number;
  pctMp: number | null;
  pctFab: number | null;
  pctOp: number | null;
  /** Cada capa como % de las VENTAS totales. */
  pctMpVsRevenue: number | null;
  pctFabVsRevenue: number | null;
  pctOpVsRevenue: number | null;
  marginPct: number | null;
}

export interface CostFactors {
  metrosReferencia: number;
  gastosFabMxn: number;
  gastosOpMxn: number;
  factorFabXMetro: number | null;
  factorOpXMetro: number | null;
  factorTotalXMetro: number | null;
  /** Denominador alternativo: metros inspeccionados (TL/INSP). */
  metrosInspeccion: number;
  factorFabInsp: number | null;
  factorOpInsp: number | null;
  factorTotalInsp: number | null;
}

export interface MetersProducedVsSold {
  mes: string;
  metrosOpAca: number;
  metrosOpV10: number;
  metrosReferencia: number;
  metrosInspeccion: number;
  metrosVendidos: number;
  kgVendidos: number;
  ratioVendidoProducido: number | null;
}

/** Gasto por KILO por mes: fabricación ÷ kg inspeccionados, operación ÷ kg vendidos. */
export interface MonthlyComparison {
  mes: string;
  gastosFabMxn: number;
  gastosOpMxn: number;
  kgInspeccion: number;
  kgVendidos: number;
  /** Factor mensual crudo (volátil — depende del volumen del mes). */
  factorFab: number | null;
  factorOp: number | null;
  factorTotal: number | null;
  /** Factor SUAVIZADO (promedio móvil ponderado 12m) — el que usa el costeo. */
  factorFabSmooth: number | null;
  factorOpSmooth: number | null;
  factorTotalSmooth: number | null;
}

/** Totales de productos NO vendidos en metros (kg/Servicio/Pieza), solo MP. */
export interface NonMeterTotals {
  productos: number;
  qtyByUom: Record<string, number>;
  mpTotalMxn: number;
  revenueMxn: number;
  /** Margen vs costo de MP (no absorbe gastos por metro). */
  marginMpPct: number | null;
}

export interface CostReconSnapshot {
  period: string;
  rangeLabel: string;
  factors: CostFactors | null;
  rows: CostReconRow[];
  totals: CostReconTotals;
  /** Productos en kg/otros, fuera del costeo por metro (solo MP). */
  nonMeterRows: CostReconRow[];
  nonMeterTotals: NonMeterTotals;
  metersHistory: MetersProducedVsSold[];
  /** Comparación mensual de los 3 metros + gasto por metro bajo cada uno. */
  monthlyComparison: MonthlyComparison[];
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

  const [factorsRes, metersRes] = await Promise.all([
    sb.rpc("get_cost_factors_monthly", { p_months_back: 36 }),
    sb.rpc("get_meters_produced_vs_sold", { p_months_back: 12 }),
  ]);

  const factorRows = (factorsRes.data ?? []) as Record<string, unknown>[];

  // Meses dentro del rango que tienen producción de referencia (factor válido).
  // El factor $/metro es mensual; para YTD/multi-mes reconstruimos cada mes con
  // SU propio factor y sumamos (lo más preciso). Solo entran meses con metros
  // (OP-ACA/OP-V10 existen desde ene-2026), evitando diluir con meses sin datos.
  let monthsToUse = factorRows
    .filter(
      (f) =>
        (f.mes as string) >= bounds.fromMonth &&
        (f.mes as string) <= bounds.toMonth &&
        nOrNull(f.factor_fab_kg) != null,
    )
    .map((f) => f.mes as string)
    .sort();
  // Cap defensivo para rangos largos (ltm/3y/5y/all).
  if (monthsToUse.length > 24) monthsToUse = monthsToUse.slice(-24);
  // Fallback: si el rango no cae en ningún mes productivo, usa el último mes.
  if (monthsToUse.length === 0) monthsToUse = [bounds.toMonth];

  const isRange = monthsToUse.length > 1;
  const period = isRange
    ? `${monthsToUse[0]}…${monthsToUse[monthsToUse.length - 1]}`
    : monthsToUse[0];

  // Reconstrucción por mes (cada uno con su factor) → agregamos por producto.
  const reconResults = await Promise.all(
    monthsToUse.map((m) =>
      sb.rpc("get_full_cost_reconstruction", { p_period: m }),
    ),
  );

  const acc = new Map<number, CostReconRow>();
  for (const res of reconResults) {
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
      const id = n(r.odoo_product_id);
      const existing = acc.get(id);
      if (existing) {
        existing.qtySold += n(r.qty_sold);
        existing.revenueMxn += n(r.revenue_mxn);
        existing.costoPrimoTotalMxn += n(r.costo_primo_total_mxn);
        existing.costoPrimoAvgTotalMxn += n(r.costo_primo_avg_total_mxn);
        existing.gastosFabTotalMxn += n(r.gastos_fab_total_mxn);
        existing.gastosOpTotalMxn += n(r.gastos_op_total_mxn);
        existing.costoTotalMxn += n(r.costo_total_mxn);
      } else {
        acc.set(id, {
          productId: id,
          productRef: (r.product_ref as string) ?? null,
          productName: (r.product_name as string) ?? null,
          uom: (r.uom as string) ?? null,
          qtySold: n(r.qty_sold),
          revenueMxn: n(r.revenue_mxn),
          costoPrimoUnitMxn: 0,
          costoPrimoAvgUnitMxn: 0,
          costoPrimoAvgTotalMxn: n(r.costo_primo_avg_total_mxn),
          factorFabUnitMxn: 0,
          factorOpUnitMxn: 0,
          costoTotalUnitMxn: 0,
          costoPrimoTotalMxn: n(r.costo_primo_total_mxn),
          gastosFabTotalMxn: n(r.gastos_fab_total_mxn),
          gastosOpTotalMxn: n(r.gastos_op_total_mxn),
          costoTotalMxn: n(r.costo_total_mxn),
          pctMp: null,
          pctFab: null,
          pctOp: null,
          pctMpVsRevenue: null,
          pctFabVsRevenue: null,
          pctOpVsRevenue: null,
          marginFullPct: null,
          mpSource: (r.mp_source as string) ?? "—",
        });
      }
    }
  }

  // Recalcula unitarios (promedio ponderado del rango) y porcentajes.
  // El factor $/metro ya viene aplicado por el RPC: a metros directo y a kg
  // convertidos a metros-equivalentes (product_uom_conversion). Los que no
  // tienen conversión (desperdicio/servicio/pieza) vienen con factor 0.
  const allRows: CostReconRow[] = Array.from(acc.values()).map((r) => {
    if (r.qtySold > 0) {
      r.costoPrimoUnitMxn = r.costoPrimoTotalMxn / r.qtySold;
      r.costoPrimoAvgUnitMxn = r.costoPrimoAvgTotalMxn / r.qtySold;
      r.factorFabUnitMxn = r.gastosFabTotalMxn / r.qtySold;
      r.factorOpUnitMxn = r.gastosOpTotalMxn / r.qtySold;
      r.costoTotalUnitMxn =
        r.costoPrimoUnitMxn + r.factorFabUnitMxn + r.factorOpUnitMxn;
    }
    if (r.costoTotalMxn > 0) {
      r.pctMp = (r.costoPrimoTotalMxn / r.costoTotalMxn) * 100;
      r.pctFab = (r.gastosFabTotalMxn / r.costoTotalMxn) * 100;
      r.pctOp = (r.gastosOpTotalMxn / r.costoTotalMxn) * 100;
    }
    if (r.revenueMxn > 0) {
      r.pctMpVsRevenue = (r.costoPrimoTotalMxn / r.revenueMxn) * 100;
      r.pctFabVsRevenue = (r.gastosFabTotalMxn / r.revenueMxn) * 100;
      r.pctOpVsRevenue = (r.gastosOpTotalMxn / r.revenueMxn) * 100;
      r.marginFullPct =
        ((r.revenueMxn - r.costoTotalMxn) / r.revenueMxn) * 100;
    }
    return r;
  });

  // Separa: análisis principal = productos costeados (metros directos + kg
  // convertidos que absorben factor). Aparte = sin factor (desperdicio /
  // servicio / pieza / kg sin conversión), solo con MP.
  const isCosted = (r: CostReconRow) =>
    r.uom === "m" || r.gastosFabTotalMxn > 0 || r.gastosOpTotalMxn > 0;
  const rows = allRows
    .filter(isCosted)
    .sort((a, b) => b.costoTotalMxn - a.costoTotalMxn);
  const nonMeterRows = allRows
    .filter((r) => !isCosted(r))
    .sort((a, b) => b.revenueMxn - a.revenueMxn);

  // Factores agregados del rango (blended = Σ gastos / Σ metros).
  const inRange = factorRows.filter((f) =>
    monthsToUse.includes(f.mes as string),
  );
  const sumMetros = inRange.reduce((s, f) => s + n(f.metros_referencia), 0);
  const sumInsp = inRange.reduce((s, f) => s + n(f.metros_inspeccion), 0);
  const sumFab = inRange.reduce((s, f) => s + n(f.gastos_fabricacion_mxn), 0);
  const sumOp = inRange.reduce((s, f) => s + n(f.gastos_operacion_mxn), 0);
  const factors: CostFactors | null =
    inRange.length > 0
      ? {
          metrosReferencia: sumMetros,
          gastosFabMxn: sumFab,
          gastosOpMxn: sumOp,
          factorFabXMetro: sumMetros > 0 ? sumFab / sumMetros : null,
          factorOpXMetro: sumMetros > 0 ? sumOp / sumMetros : null,
          factorTotalXMetro: sumMetros > 0 ? (sumFab + sumOp) / sumMetros : null,
          metrosInspeccion: sumInsp,
          factorFabInsp: sumInsp > 0 ? sumFab / sumInsp : null,
          factorOpInsp: sumInsp > 0 ? sumOp / sumInsp : null,
          factorTotalInsp: sumInsp > 0 ? (sumFab + sumOp) / sumInsp : null,
        }
      : null;

  // Totales
  const totals = rows.reduce<CostReconTotals>(
    (acc, r) => {
      acc.mpTotalMxn += r.costoPrimoTotalMxn;
      acc.mpAvgTotalMxn += r.costoPrimoAvgTotalMxn;
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
      mpAvgTotalMxn: 0,
      fabTotalMxn: 0,
      opTotalMxn: 0,
      costoTotalMxn: 0,
      revenueMxn: 0,
      pctMp: null,
      pctFab: null,
      pctOp: null,
      pctMpVsRevenue: null,
      pctFabVsRevenue: null,
      pctOpVsRevenue: null,
      marginPct: null,
    },
  );
  if (totals.costoTotalMxn > 0) {
    totals.pctMp = (totals.mpTotalMxn / totals.costoTotalMxn) * 100;
    totals.pctFab = (totals.fabTotalMxn / totals.costoTotalMxn) * 100;
    totals.pctOp = (totals.opTotalMxn / totals.costoTotalMxn) * 100;
  }
  if (totals.revenueMxn > 0) {
    totals.pctMpVsRevenue = (totals.mpTotalMxn / totals.revenueMxn) * 100;
    totals.pctFabVsRevenue = (totals.fabTotalMxn / totals.revenueMxn) * 100;
    totals.pctOpVsRevenue = (totals.opTotalMxn / totals.revenueMxn) * 100;
    totals.marginPct =
      ((totals.revenueMxn - totals.costoTotalMxn) / totals.revenueMxn) * 100;
  }

  // Totales kg / otros (solo MP, sin factor por metro).
  const nonMeterTotals: NonMeterTotals = {
    productos: nonMeterRows.length,
    qtyByUom: {},
    mpTotalMxn: nonMeterRows.reduce((s, r) => s + r.costoPrimoTotalMxn, 0),
    revenueMxn: nonMeterRows.reduce((s, r) => s + r.revenueMxn, 0),
    marginMpPct: null,
  };
  for (const r of nonMeterRows) {
    const u = r.uom ?? "—";
    nonMeterTotals.qtyByUom[u] = (nonMeterTotals.qtyByUom[u] ?? 0) + r.qtySold;
  }
  if (nonMeterTotals.revenueMxn > 0) {
    nonMeterTotals.marginMpPct =
      ((nonMeterTotals.revenueMxn - nonMeterTotals.mpTotalMxn) /
        nonMeterTotals.revenueMxn) *
      100;
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
      metrosInspeccion: n(m.metros_inspeccion),
      metrosVendidos: n(m.metros_vendidos),
      kgVendidos: n(m.kg_vendidos),
      ratioVendidoProducido: nOrNull(m.ratio_vendido_producido),
    }));

  // Gasto por metro por mes: fabricación ÷ inspeccionado, operación ÷ vendido.
  const monthlyComparison: MonthlyComparison[] = factorRows
    .map((f) => {
      const gastosFab = n(f.gastos_fabricacion_mxn);
      const gastosOp = n(f.gastos_operacion_mxn);
      const factorFab = nOrNull(f.factor_fab_kg);
      const factorOp = nOrNull(f.factor_op_kg);
      const factorFabSmooth = nOrNull(f.factor_fab_kg_smooth);
      const factorOpSmooth = nOrNull(f.factor_op_kg_smooth);
      return {
        mes: f.mes as string,
        gastosFabMxn: gastosFab,
        gastosOpMxn: gastosOp,
        kgInspeccion: n(f.kg_inspeccion),
        kgVendidos: n(f.kg_vendidos),
        factorFab,
        factorOp,
        factorTotal:
          factorFab != null || factorOp != null
            ? (factorFab ?? 0) + (factorOp ?? 0)
            : null,
        factorFabSmooth,
        factorOpSmooth,
        factorTotalSmooth:
          factorFabSmooth != null || factorOpSmooth != null
            ? (factorFabSmooth ?? 0) + (factorOpSmooth ?? 0)
            : null,
      };
    })
    // Solo meses con gastos normales (excluye cierre anual con saldos negativos)
    .filter((c) => c.gastosFabMxn > 0 && c.kgInspeccion > 0)
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return {
    period,
    rangeLabel: bounds.label,
    factors,
    rows,
    totals,
    nonMeterRows,
    nonMeterTotals,
    metersHistory,
    monthlyComparison,
  };
}

export const getCostReconSnapshot = (range: HistoryRange) =>
  unstable_cache(
    () => _getCostReconSnapshotRaw(range),
    ["sp13-cost-reconstruction-v12-smoothed-factor", String(range)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
