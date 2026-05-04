import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * Cost centers (centros de costo) — desglose de MOD (501.06) y overhead
 * fábrica (504.01) por departamento productivo.
 *
 * Quimibond usa AVCO + workcenters solo en Tejido Circular (go-live mayo
 * 2026). Acabado/Tintorería/Entretelas/Empaque NO absorben MOD+OH al PT
 * → variable costing implícito. Estos centros existen para visibilizar
 * cuánto cuesta cada proceso y calcular burden rate por unidad para
 * cuando se configuren los workcenters faltantes.
 */

export interface NominaByCostCenter {
  costCenterCode: string;
  costCenterName: string;
  nature: "fabril_directo" | "fabril_indirecto" | "admin";
  numAsientos: number;
  totalNominaMxn: number;
}

export interface OverheadByCostCenter {
  costCenterCode: string;
  costCenterName: string;
  nature: "fabril_directo" | "fabril_indirecto" | "admin";
  rentMxn: number;
  utilitiesMxn: number;
  otherOverheadMxn: number;
  totalOverheadMxn: number;
}

export interface ProductionByCostCenter {
  costCenterCode: string;
  costCenterName: string;
  qtyProduced: number;
  outputUom: string | null;
  numMoves: number;
  valueProducedMxn: number;
}

export interface CostCenterRow {
  costCenterCode: string;
  costCenterName: string;
  nature: "fabril_directo" | "fabril_indirecto" | "admin";
  hasWorkcenter: boolean;
  workcenterGoLiveDate: string | null;
  outputUom: string | null;
  nominaMxn: number;
  rentMxn: number;
  utilitiesMxn: number;
  otherOverheadMxn: number;
  totalOverheadMxn: number;
  totalCostMxn: number;
  qtyProduced: number;
  burdenRatePerUnit: number | null;
}

export interface CostCentersSnapshot {
  period: string;
  rangeLabel: string;
  rows: CostCenterRow[];
  totals: {
    nominaMxn: number;
    rentMxn: number;
    utilitiesMxn: number;
    otherOverheadMxn: number;
    totalOverheadMxn: number;
    totalCostMxn: number;
  };
}

interface CostCenterConfigRow {
  code: string;
  name: string;
  nature: "fabril_directo" | "fabril_indirecto" | "admin";
  has_workcenter: boolean;
  workcenter_go_live_date: string | null;
  output_uom: string | null;
  active: boolean;
}

async function _getCostCentersSnapshotRaw(
  range: HistoryRange,
): Promise<CostCentersSnapshot> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  // RPCs accept a single month period (YYYY-MM); use the last month of range.
  const period = bounds.toMonth;

  const [configRes, nominaRes, overheadRes, productionRes] = await Promise.all([
    sb
      .from("cost_center_config")
      .select(
        "code,name,nature,has_workcenter,workcenter_go_live_date,output_uom,active",
      )
      .eq("active", true),
    sb.rpc("get_nomina_by_cost_center", { p_period: period }),
    sb.rpc("get_overhead_by_cost_center", { p_period: period }),
    sb.rpc("get_production_by_cost_center", { p_period: period }),
  ]);

  const configs = (configRes.data ?? []) as CostCenterConfigRow[];
  const nominaRows = (nominaRes.data ?? []) as Array<{
    cost_center_code: string;
    cost_center_name: string;
    nature: "fabril_directo" | "fabril_indirecto" | "admin";
    num_asientos: number;
    total_nomina_mxn: number;
  }>;
  const overheadRows = (overheadRes.data ?? []) as Array<{
    cost_center_code: string;
    cost_center_name: string;
    nature: "fabril_directo" | "fabril_indirecto" | "admin";
    rent_mxn: number;
    utilities_mxn: number;
    other_overhead_mxn: number;
    total_overhead_mxn: number;
  }>;
  const productionRows = (productionRes.data ?? []) as Array<{
    cost_center_code: string;
    cost_center_name: string;
    qty_produced: number;
    output_uom: string | null;
    num_moves: number;
    value_produced_mxn: number;
  }>;

  const nominaByCode = new Map(nominaRows.map((r) => [r.cost_center_code, r]));
  const overheadByCode = new Map(
    overheadRows.map((r) => [r.cost_center_code, r]),
  );
  const productionByCode = new Map(
    productionRows.map((r) => [r.cost_center_code, r]),
  );

  // Universe = all configured + any extra code present in any RPC (e.g. SIN_CLASIFICAR)
  const allCodes = new Set<string>();
  for (const c of configs) allCodes.add(c.code);
  for (const r of nominaRows) allCodes.add(r.cost_center_code);
  for (const r of overheadRows) allCodes.add(r.cost_center_code);
  for (const r of productionRows) allCodes.add(r.cost_center_code);

  const rows: CostCenterRow[] = Array.from(allCodes).map((code) => {
    const config = configs.find((c) => c.code === code);
    const nomina = nominaByCode.get(code);
    const overhead = overheadByCode.get(code);
    const production = productionByCode.get(code);

    const name =
      config?.name ?? nomina?.cost_center_name ?? overhead?.cost_center_name ??
      production?.cost_center_name ?? code;
    const nature: "fabril_directo" | "fabril_indirecto" | "admin" =
      config?.nature ??
      nomina?.nature ??
      overhead?.nature ??
      "admin";

    const nominaMxn = num(nomina?.total_nomina_mxn);
    const rentMxn = num(overhead?.rent_mxn);
    const utilitiesMxn = num(overhead?.utilities_mxn);
    const otherOverheadMxn = num(overhead?.other_overhead_mxn);
    const totalOverheadMxn = num(overhead?.total_overhead_mxn);
    const totalCostMxn = nominaMxn + totalOverheadMxn;
    const qtyProduced = num(production?.qty_produced);
    const burdenRatePerUnit =
      qtyProduced > 0 && totalCostMxn > 0
        ? totalCostMxn / qtyProduced
        : null;

    return {
      costCenterCode: code,
      costCenterName: name,
      nature,
      hasWorkcenter: config?.has_workcenter ?? false,
      workcenterGoLiveDate: config?.workcenter_go_live_date ?? null,
      outputUom: config?.output_uom ?? production?.output_uom ?? null,
      nominaMxn,
      rentMxn,
      utilitiesMxn,
      otherOverheadMxn,
      totalOverheadMxn,
      totalCostMxn,
      qtyProduced,
      burdenRatePerUnit,
    };
  });

  // Sort: fabril_directo first by total cost desc, then fabril_indirecto, then admin
  const natureRank = { fabril_directo: 0, fabril_indirecto: 1, admin: 2 };
  rows.sort((a, b) => {
    const r = natureRank[a.nature] - natureRank[b.nature];
    if (r !== 0) return r;
    return b.totalCostMxn - a.totalCostMxn;
  });

  const totals = rows.reduce(
    (acc, r) => ({
      nominaMxn: acc.nominaMxn + r.nominaMxn,
      rentMxn: acc.rentMxn + r.rentMxn,
      utilitiesMxn: acc.utilitiesMxn + r.utilitiesMxn,
      otherOverheadMxn: acc.otherOverheadMxn + r.otherOverheadMxn,
      totalOverheadMxn: acc.totalOverheadMxn + r.totalOverheadMxn,
      totalCostMxn: acc.totalCostMxn + r.totalCostMxn,
    }),
    {
      nominaMxn: 0,
      rentMxn: 0,
      utilitiesMxn: 0,
      otherOverheadMxn: 0,
      totalOverheadMxn: 0,
      totalCostMxn: 0,
    },
  );

  return {
    period,
    rangeLabel: bounds.label,
    rows,
    totals,
  };
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const getCostCentersSnapshot = (range: HistoryRange) =>
  unstable_cache(
    () => _getCostCentersSnapshotRaw(range),
    ["sp13-cost-centers-snapshot-v1", String(range)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
