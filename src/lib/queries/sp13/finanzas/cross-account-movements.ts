import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Análisis cross-account: para un mes específico, encontrar todas las
 * cuentas P&L con cambios materiales vs:
 *   - Mes anterior (MoM)
 *   - Promedio últimos 3 meses cerrados (run rate)
 *   - Mismo mes año anterior (YoY)
 *
 * Cada cuenta tiene flag is_anomaly = true si el cambio vs run rate
 * supera 2x el promedio O excede $500k absolutos.
 *
 * Use case: el CEO abre la página y ve inmediatamente "estos son los
 * 10 lugares donde el dinero se movió más fuera de lo normal" sin
 * tener que saber qué cuenta buscar.
 */

export interface AccountMovement {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  bucket: string;
  currMxn: number;
  prevMxn: number;
  avg3mMxn: number;
  yoyMxn: number;
  deltaMomAbs: number;
  deltaMomPct: number | null;
  deltaVsAvgAbs: number;
  deltaVsAvgPct: number | null;
  deltaYoyAbs: number;
  deltaYoyPct: number | null;
  isAnomaly: boolean;
}

export interface CrossAccountMovementsSummary {
  period: string;
  movements: AccountMovement[];
  totalAbsChange: number;
  anomalyCount: number;
}

const BUCKET_LABEL: Record<string, string> = {
  income_4xx: "Ventas",
  income_7xx: "Otros ingresos",
  cogs_501_01: "COGS contable",
  mod_501_06: "Mano de obra",
  compras_502: "Compras imp.",
  overhead_504_01: "Overhead fábrica",
  dep_504_08_23: "Dep. fábrica",
  dep_corpo_613: "Dep. CORPO",
  gastos_op_6xx: "Gasto admin/ventas",
  otro: "Otro",
};

export const ALL_BUCKET_LABELS = BUCKET_LABEL;

async function _getCrossAccountMovementsRaw(
  period: string,
  minAbsChange = 50000
): Promise<CrossAccountMovementsSummary> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_cross_account_movements", {
    p_period: period,
    p_min_abs_change: minAbsChange,
  });
  if (error) throw error;

  type Rpc = {
    account_code: string;
    account_name: string | null;
    account_type: string | null;
    bucket: string;
    curr_mxn: number | string;
    prev_mxn: number | string;
    avg3m_mxn: number | string;
    yoy_mxn: number | string;
    delta_mom_abs: number | string;
    delta_mom_pct: number | string | null;
    delta_vs_avg_abs: number | string;
    delta_vs_avg_pct: number | string | null;
    delta_yoy_abs: number | string;
    delta_yoy_pct: number | string | null;
    is_anomaly: boolean | null;
  };
  const movements: AccountMovement[] = ((data ?? []) as Rpc[]).map((r) => ({
    accountCode: r.account_code,
    accountName: r.account_name ?? r.account_code,
    accountType: r.account_type,
    bucket: r.bucket,
    currMxn: Number(r.curr_mxn) || 0,
    prevMxn: Number(r.prev_mxn) || 0,
    avg3mMxn: Number(r.avg3m_mxn) || 0,
    yoyMxn: Number(r.yoy_mxn) || 0,
    deltaMomAbs: Number(r.delta_mom_abs) || 0,
    deltaMomPct: r.delta_mom_pct == null ? null : Number(r.delta_mom_pct),
    deltaVsAvgAbs: Number(r.delta_vs_avg_abs) || 0,
    deltaVsAvgPct:
      r.delta_vs_avg_pct == null ? null : Number(r.delta_vs_avg_pct),
    deltaYoyAbs: Number(r.delta_yoy_abs) || 0,
    deltaYoyPct: r.delta_yoy_pct == null ? null : Number(r.delta_yoy_pct),
    isAnomaly: Boolean(r.is_anomaly),
  }));

  const totalAbsChange = movements.reduce(
    (s, m) => s + Math.abs(m.deltaVsAvgAbs),
    0
  );
  const anomalyCount = movements.filter((m) => m.isAnomaly).length;

  return {
    period,
    movements,
    totalAbsChange: Math.round(totalAbsChange * 100) / 100,
    anomalyCount,
  };
}

export const getCrossAccountMovements = (period: string, minAbsChange = 50000) =>
  unstable_cache(
    () => _getCrossAccountMovementsRaw(period, minAbsChange),
    ["sp13-cross-account-movements-v1", period, String(minAbsChange)],
    { revalidate: 600, tags: ["finanzas"] }
  )();
