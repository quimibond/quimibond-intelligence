import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Costo de defectos y degradación a saldo — medición analítica.
 *
 * RPC: `get_defect_cost_monthly(p_months_back)` retorna por mes y canal:
 *  - defectos_tejido: subproducto SALDO nacido en órdenes TL/OP-%.
 *    Costo = kg × costo unitario de la orden (funciona aunque el saldo
 *    entre a $0 con cost share 0%).
 *  - degradacion_conversion: tela convertida a saldo vía TL/CONV-%
 *    (kg y valor AVCO transferido desde las telas).
 *  - ajuste_valuado: entradas de saldo por ajuste de inventario CON valor.
 *    Bajo la política "saldo a $0" debe ser cero siempre — cualquier
 *    monto aquí es bandera roja.
 *
 * Contexto: el costo del desperdicio ya está cobrado en la tela buena
 * (BOMs de acabado consumen +12-18% vs peso teórico). Ver pending action
 * `saldo-desperdicio-costo-cero`.
 */

/** Degradación mensual por encima de esto se marca como atípica */
export const DEGRADACION_ALERT_MXN = 500_000;

export interface DefectCostMonth {
  mes: string;
  tejidoKg: number;
  tejidoCostoMxn: number;
  tejidoOrdenes: number;
  convKg: number;
  convCostoMxn: number;
  convOrdenes: number;
  ajusteKg: number;
  ajusteCostoMxn: number;
  totalCostoMxn: number;
  /** Mes corriente, aún incompleto */
  isPartial: boolean;
}

export interface DefectCostSummary {
  months: DefectCostMonth[];
  /** Promedio mensual de degradación (meses completos con actividad) */
  avgDegradacionMxn: number | null;
  totalDegradacion12m: number;
  totalAjustesValuados12m: number;
  /** Último mes completo con degradación por encima del umbral */
  lastAlertMes: string | null;
}

type RpcRow = {
  mes: string;
  canal: "defectos_tejido" | "degradacion_conversion" | "ajuste_valuado";
  kg: number | string;
  costo_mxn: number | string;
  eventos: number | string;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function _getDefectCostRaw(monthsBack = 18): Promise<DefectCostSummary> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_defect_cost_monthly", {
    p_months_back: monthsBack,
  });
  if (error) {
    console.error("[getDefectCost] rpc failed", error.message);
    return {
      months: [],
      avgDegradacionMxn: null,
      totalDegradacion12m: 0,
      totalAjustesValuados12m: 0,
      lastAlertMes: null,
    };
  }

  const byMes = new Map<string, DefectCostMonth>();
  const currentMonth = new Date().toISOString().slice(0, 7);

  for (const r of (data ?? []) as RpcRow[]) {
    let m = byMes.get(r.mes);
    if (!m) {
      m = {
        mes: r.mes,
        tejidoKg: 0,
        tejidoCostoMxn: 0,
        tejidoOrdenes: 0,
        convKg: 0,
        convCostoMxn: 0,
        convOrdenes: 0,
        ajusteKg: 0,
        ajusteCostoMxn: 0,
        totalCostoMxn: 0,
        isPartial: r.mes === currentMonth,
      };
      byMes.set(r.mes, m);
    }
    const kg = num(r.kg);
    const costo = num(r.costo_mxn);
    if (r.canal === "defectos_tejido") {
      m.tejidoKg += kg;
      m.tejidoCostoMxn += costo;
      m.tejidoOrdenes += num(r.eventos);
    } else if (r.canal === "degradacion_conversion") {
      m.convKg += kg;
      m.convCostoMxn += costo;
      m.convOrdenes += num(r.eventos);
    } else {
      m.ajusteKg += kg;
      m.ajusteCostoMxn += costo;
    }
    m.totalCostoMxn += costo;
  }

  const months = [...byMes.values()].sort((a, b) =>
    b.mes.localeCompare(a.mes),
  );

  const complete = months.filter((m) => !m.isPartial);
  const withConv = complete.filter((m) => m.convCostoMxn > 0);
  const last12 = complete.slice(0, 12);

  const lastAlert = complete.find(
    (m) => m.convCostoMxn > DEGRADACION_ALERT_MXN,
  );

  return {
    months,
    avgDegradacionMxn:
      withConv.length > 0
        ? withConv.reduce((s, m) => s + m.convCostoMxn, 0) / withConv.length
        : null,
    totalDegradacion12m: last12.reduce((s, m) => s + m.convCostoMxn, 0),
    totalAjustesValuados12m: last12.reduce((s, m) => s + m.ajusteCostoMxn, 0),
    lastAlertMes: lastAlert?.mes ?? null,
  };
}

export const getDefectCost = (monthsBack = 18) =>
  unstable_cache(
    () => _getDefectCostRaw(monthsBack),
    ["sp13-defect-cost-v1", String(monthsBack)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
