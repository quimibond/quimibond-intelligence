import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Costo estándar normalizado por centro de trabajo (mes con mes).
 *
 * El GL contable es lumpy (renta que se paga cuando hay flujo, reversos de
 * cierre anual, energía facturada con rezago). Para fijar el costo/hora de un
 * workcenter en Odoo NO sirve el mes contable: hay que normalizar.
 *
 * Fuentes:
 *  - RPC `get_cost_center_cost_monthly(centro, meses)` → componentes por mes.
 *    Renta = CONTRACTUAL (rent_lot_assignment), fija; el resto del GL.
 *  - Tabla `workcenter_cost_config` → horas-máquina objetivo + % depreciación
 *    de maquinaria (editable para "irlo moviendo").
 *
 * La tarifa SUGERIDA = costo normalizado (promedio de meses válidos) ÷ horas
 * objetivo. Los meses con total ≤ 0 (reverso de cierre) o el mes corriente
 * incompleto se excluyen del promedio.
 */

export interface WorkcenterCostMonth {
  mes: string;
  modMxn: number;
  rentaMxn: number;
  energiaServiciosMxn: number;
  manttoOtrosMxn: number;
  deprecMaquinariaMxn: number;
  totalFabrilMxn: number;
  horasMaquina: number;
  /** Mes anómalo (reverso de cierre, total ≤ 0) o incompleto → fuera del promedio. */
  excluido: boolean;
}

export interface WorkcenterCostConfig {
  costCenter: string;
  nMachines: number | null;
  machineDeprecPct: number;
  targetMachineHours: number | null;
  notes: string | null;
}

export interface WorkcenterStandardSummary {
  months: WorkcenterCostMonth[];
  config: WorkcenterCostConfig | null;
  /** Promedio mensual normalizado (meses válidos). */
  norm: {
    modMxn: number;
    rentaMxn: number;
    energiaServiciosMxn: number;
    manttoOtrosMxn: number;
    deprecMaquinariaMxn: number;
    overheadMxn: number; // renta + energia + otros + deprec
    totalMxn: number;
    /** Horas-máquina promedio (derivadas de producción). */
    machineHours: number;
    nMeses: number;
  } | null;
  /** Tarifas sugeridas (costo normalizado ÷ horas-máquina). */
  suggested: {
    costsHour: number | null; // overhead ÷ horas
    employeeCostsHour: number | null; // MOD ÷ horas
    totalHour: number | null;
    /** Horas-máquina usadas como denominador (override de config o promedio). */
    machineHoursUsed: number;
  } | null;
}

type RpcRow = {
  mes: string;
  mod_mxn: number | string;
  renta_mxn: number | string;
  energia_servicios_mxn: number | string;
  mantto_otros_mxn: number | string;
  deprec_maquinaria_mxn: number | string;
  total_fabril_mxn: number | string;
  horas_maquina: number | string;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function _getRaw(
  costCenter: string,
  monthsBack: number,
): Promise<WorkcenterStandardSummary> {
  const sb = getServiceClient();

  const [rpc, cfgRes] = await Promise.all([
    sb.rpc("get_cost_center_cost_monthly", {
      p_cost_center: costCenter,
      p_months_back: monthsBack,
    }),
    sb
      .from("workcenter_cost_config")
      .select("*")
      .eq("cost_center_code", costCenter)
      .maybeSingle(),
  ]);

  if (rpc.error) {
    console.error("[getWorkcenterStandard] rpc failed", rpc.error.message);
    return { months: [], config: null, norm: null, suggested: null };
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  const months: WorkcenterCostMonth[] = ((rpc.data ?? []) as RpcRow[]).map(
    (r) => {
      const total = num(r.total_fabril_mxn);
      const mod = num(r.mod_mxn);
      // Excluir reverso de cierre (total ≤ 0) y el mes corriente incompleto.
      const excluido = total <= 0 || mod <= 0 || r.mes === currentMonth;
      return {
        mes: r.mes,
        modMxn: mod,
        rentaMxn: num(r.renta_mxn),
        energiaServiciosMxn: num(r.energia_servicios_mxn),
        manttoOtrosMxn: num(r.mantto_otros_mxn),
        deprecMaquinariaMxn: num(r.deprec_maquinaria_mxn),
        totalFabrilMxn: total,
        horasMaquina: num(r.horas_maquina),
        excluido,
      };
    },
  );

  const cfgRow = cfgRes.data as Record<string, unknown> | null;
  const config: WorkcenterCostConfig | null = cfgRow
    ? {
        costCenter,
        nMachines: cfgRow.n_machines != null ? Number(cfgRow.n_machines) : null,
        machineDeprecPct: num(cfgRow.machine_deprec_pct as number),
        targetMachineHours:
          cfgRow.target_machine_hours != null
            ? Number(cfgRow.target_machine_hours)
            : null,
        notes: (cfgRow.notes as string) ?? null,
      }
    : null;

  // Válidos para promediar: sin reverso de cierre / mes incompleto y con
  // horas-máquina > 0 (derivadas de producción).
  const validos = months.filter((m) => !m.excluido && m.horasMaquina > 0);
  const n = validos.length;
  const avg = (sel: (m: WorkcenterCostMonth) => number) =>
    n > 0 ? validos.reduce((s, m) => s + sel(m), 0) / n : 0;

  const norm =
    n > 0
      ? {
          modMxn: avg((m) => m.modMxn),
          rentaMxn: avg((m) => m.rentaMxn),
          energiaServiciosMxn: avg((m) => m.energiaServiciosMxn),
          manttoOtrosMxn: avg((m) => m.manttoOtrosMxn),
          deprecMaquinariaMxn: avg((m) => m.deprecMaquinariaMxn),
          overheadMxn:
            avg((m) => m.rentaMxn) +
            avg((m) => m.energiaServiciosMxn) +
            avg((m) => m.manttoOtrosMxn) +
            avg((m) => m.deprecMaquinariaMxn),
          totalMxn: avg((m) => m.totalFabrilMxn),
          machineHours: avg((m) => m.horasMaquina),
          nMeses: n,
        }
      : null;

  // Denominador: override manual (target_machine_hours) si existe; si no, el
  // promedio de horas-máquina derivadas de producción.
  const hoursUsed =
    config?.targetMachineHours && config.targetMachineHours > 0
      ? config.targetMachineHours
      : (norm?.machineHours ?? 0);
  const suggested =
    norm && hoursUsed > 0
      ? {
          costsHour: norm.overheadMxn / hoursUsed,
          employeeCostsHour: norm.modMxn / hoursUsed,
          totalHour: norm.totalMxn / hoursUsed,
          machineHoursUsed: hoursUsed,
        }
      : null;

  return { months, config, norm, suggested };
}

export const getWorkcenterStandard = (
  costCenter = "TEJIDO",
  monthsBack = 18,
) =>
  unstable_cache(
    () => _getRaw(costCenter, monthsBack),
    ["sp13-workcenter-standard-v3-prod-hours", costCenter, String(monthsBack)],
    { revalidate: 300, tags: ["sp13", "finanzas", "cost-centers"] },
  )();
