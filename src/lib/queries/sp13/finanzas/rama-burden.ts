import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Rama burden — costo por metro producido en acabado (órdenes TL/OP-ACA).
 *
 * RPC: `get_rama_burden_monthly(p_months_back)` retorna por mes:
 *  - metros_op_aca: metros terminados en la rama (state='done')
 *  - gas: litros, precio/litro, gasto (504.01.0003) y gas $/metro
 *  - gastos de fabricación = MOD (501.06) + overhead fábrica (504.01),
 *    SIN costo primo MP, y su versión con depreciación fábrica (504.08-23)
 *  - fabricación $/metro
 *
 * Umbral de alerta gas: > $0.75/mt = baja eficiencia (la rama tiene costo
 * base fijo de gas; con producción <750k mt/mes el costo unitario se dispara).
 *
 * Las OPs de acabado existen en Odoo desde enero 2026.
 */

export const GAS_PER_METER_ALERT_THRESHOLD = 0.75;

export interface RamaBurdenMonth {
  mes: string;
  opsTerminadas: number;
  metrosOpAca: number;
  gasLitros: number;
  gasPrecioLitro: number | null;
  gasGastoMxn: number;
  gasPorMetro: number | null;
  litrosPorMetro: number | null;
  modMxn: number;
  overheadMxn: number;
  depreciacionMxn: number;
  gastosFabricacionMxn: number;
  fabricacionPorMetro: number | null;
  fabricacionConDepPorMetro: number | null;
  /** Mes corriente con contabilidad aún incompleta */
  isPartial: boolean;
}

export interface RamaBurdenSummary {
  months: RamaBurdenMonth[];
  /** Promedios ponderados de los meses completos */
  avgGasPorMetro: number | null;
  avgFabricacionPorMetro: number | null;
  totalMetros: number;
  totalGastosFabricacion: number;
}

type RpcRow = {
  mes: string;
  ops_terminadas: number | string;
  metros_op_aca: number | string;
  gas_litros: number | string;
  gas_precio_litro: number | string | null;
  gas_gasto_mxn: number | string;
  gas_por_metro: number | string | null;
  mod_mxn: number | string;
  overhead_mxn: number | string;
  depreciacion_mxn: number | string;
  gastos_fabricacion_mxn: number | string;
  fabricacion_por_metro: number | string | null;
  fabricacion_con_dep_por_metro: number | string | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function _getRamaBurdenRaw(monthsBack = 12): Promise<RamaBurdenSummary> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_rama_burden_monthly", {
    p_months_back: monthsBack,
  });
  if (error) {
    console.error("[getRamaBurden] rpc failed", error.message);
    return {
      months: [],
      avgGasPorMetro: null,
      avgFabricacionPorMetro: null,
      totalMetros: 0,
      totalGastosFabricacion: 0,
    };
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  const months: RamaBurdenMonth[] = ((data ?? []) as RpcRow[])
    // Solo meses con producción registrada en la rama
    .filter((r) => num(r.metros_op_aca) > 0)
    .map((r) => {
      const metros = num(r.metros_op_aca);
      const litros = num(r.gas_litros);
      // Mes corriente: la contabilidad (nóminas, facturas de gas) llega con
      // rezago — marcar parcial para no leer el $/mt como real.
      const isPartial =
        r.mes === currentMonth || num(r.gastos_fabricacion_mxn) === 0;
      return {
        mes: r.mes,
        opsTerminadas: num(r.ops_terminadas),
        metrosOpAca: metros,
        gasLitros: litros,
        gasPrecioLitro: numOrNull(r.gas_precio_litro),
        gasGastoMxn: num(r.gas_gasto_mxn),
        gasPorMetro: numOrNull(r.gas_por_metro),
        litrosPorMetro: metros > 0 && litros > 0 ? litros / metros : null,
        modMxn: num(r.mod_mxn),
        overheadMxn: num(r.overhead_mxn),
        depreciacionMxn: num(r.depreciacion_mxn),
        gastosFabricacionMxn: num(r.gastos_fabricacion_mxn),
        fabricacionPorMetro: numOrNull(r.fabricacion_por_metro),
        fabricacionConDepPorMetro: numOrNull(r.fabricacion_con_dep_por_metro),
        isPartial,
      };
    });

  const complete = months.filter((m) => !m.isPartial);
  const totalMetros = complete.reduce((s, m) => s + m.metrosOpAca, 0);
  const totalGas = complete.reduce((s, m) => s + m.gasGastoMxn, 0);
  const totalFab = complete.reduce((s, m) => s + m.gastosFabricacionMxn, 0);

  return {
    months,
    avgGasPorMetro: totalMetros > 0 ? totalGas / totalMetros : null,
    avgFabricacionPorMetro: totalMetros > 0 ? totalFab / totalMetros : null,
    totalMetros,
    totalGastosFabricacion: totalFab,
  };
}

export const getRamaBurden = (monthsBack = 12) =>
  unstable_cache(
    () => _getRamaBurdenRaw(monthsBack),
    ["sp13-rama-burden-v1", String(monthsBack)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
