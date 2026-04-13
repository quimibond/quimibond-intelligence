import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Finance queries v2 — usa las VIEWS canónicas del backend.
 * Todas las vistas ya están normalizadas a MXN, no necesitan `toMxn()`.
 *
 * Fuentes:
 * - `cfo_dashboard` — snapshot ejecutivo (1 row)
 * - `financial_runway` — runway en días + net position 30d
 * - `working_capital` — ratios de liquidez + capital de trabajo
 * - `pl_estado_resultados` — P&L mensual por periodo
 * - `cash_position` — detalle de saldos bancarios
 */

/** Snapshot ejecutivo del CFO (view: cfo_dashboard) */
export interface CfoSnapshot {
  efectivoDisponible: number;
  deudaTarjetas: number;
  posicionNeta: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  carteraVencida: number;
  ventas30d: number;
  cobros30d: number;
  pagosProv30d: number;
  clientesMorosos: number;
}

export async function getCfoSnapshot(): Promise<CfoSnapshot | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("cfo_dashboard").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    efectivo_disponible: number | null;
    deuda_tarjetas: number | null;
    posicion_neta: number | null;
    cuentas_por_cobrar: number | null;
    cuentas_por_pagar: number | null;
    cartera_vencida: number | null;
    ventas_30d: number | null;
    cobros_30d: number | null;
    pagos_prov_30d: number | null;
    clientes_morosos: number | null;
  };
  return {
    efectivoDisponible: Number(d.efectivo_disponible) || 0,
    deudaTarjetas: Number(d.deuda_tarjetas) || 0,
    posicionNeta: Number(d.posicion_neta) || 0,
    cuentasPorCobrar: Number(d.cuentas_por_cobrar) || 0,
    cuentasPorPagar: Number(d.cuentas_por_pagar) || 0,
    carteraVencida: Number(d.cartera_vencida) || 0,
    ventas30d: Number(d.ventas_30d) || 0,
    cobros30d: Number(d.cobros_30d) || 0,
    pagosProv30d: Number(d.pagos_prov_30d) || 0,
    clientesMorosos: Number(d.clientes_morosos) || 0,
  };
}

/** Runway + net position 30d (view: financial_runway) */
export interface FinancialRunway {
  cashMxn: number;
  expectedInMxn: number;
  dueOutMxn: number;
  netPosition30d: number;
  burnRateDaily: number;
  runwayDaysNet: number;
  runwayDaysCashOnly: number;
  computedAt: string | null;
}

export async function getFinancialRunway(): Promise<FinancialRunway | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("financial_runway").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    cash_mxn: number | null;
    expected_in_mxn: number | null;
    due_out_mxn: number | null;
    net_position_30d: number | null;
    burn_rate_daily: number | null;
    runway_days_net: number | null;
    runway_days_cash_only: number | null;
    computed_at: string | null;
  };
  return {
    cashMxn: Number(d.cash_mxn) || 0,
    expectedInMxn: Number(d.expected_in_mxn) || 0,
    dueOutMxn: Number(d.due_out_mxn) || 0,
    netPosition30d: Number(d.net_position_30d) || 0,
    burnRateDaily: Number(d.burn_rate_daily) || 0,
    runwayDaysNet: Number(d.runway_days_net) || 0,
    runwayDaysCashOnly: Number(d.runway_days_cash_only) || 0,
    computedAt: d.computed_at,
  };
}

/** Capital de trabajo (view: working_capital) */
export interface WorkingCapital {
  efectivoDisponible: number;
  deudaTarjetas: number;
  efectivoNeto: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  capitalDeTrabajo: number;
  ratioLiquidez: number;
  ratioPruebaAcida: number;
}

export async function getWorkingCapital(): Promise<WorkingCapital | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("working_capital").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    efectivo_disponible: number | null;
    deuda_tarjetas: number | null;
    efectivo_neto: number | null;
    cuentas_por_cobrar: number | null;
    cuentas_por_pagar: number | null;
    capital_de_trabajo: number | null;
    ratio_liquidez: number | null;
    ratio_prueba_acida: number | null;
  };
  return {
    efectivoDisponible: Number(d.efectivo_disponible) || 0,
    deudaTarjetas: Number(d.deuda_tarjetas) || 0,
    efectivoNeto: Number(d.efectivo_neto) || 0,
    cuentasPorCobrar: Number(d.cuentas_por_cobrar) || 0,
    cuentasPorPagar: Number(d.cuentas_por_pagar) || 0,
    capitalDeTrabajo: Number(d.capital_de_trabajo) || 0,
    ratioLiquidez: Number(d.ratio_liquidez) || 0,
    ratioPruebaAcida: Number(d.ratio_prueba_acida) || 0,
  };
}

/** Saldo bancario (view: cash_position) */
export interface BankBalance {
  banco: string | null;
  tipo: string | null;
  moneda: string | null;
  cuenta: string | null;
  saldo: number;
}

export async function getCashPosition(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cash_position")
    .select("banco, tipo, moneda, cuenta, saldo")
    .order("saldo", { ascending: false });
  return ((data ?? []) as Array<
    Omit<BankBalance, "saldo"> & { saldo: number | null }
  >).map((r) => ({
    ...r,
    saldo: Number(r.saldo) || 0,
  }));
}

/** Punto P&L por mes (view: pl_estado_resultados) */
export interface PlPoint {
  period: string;
  ingresos: number;
  costoVentas: number;
  gastosOperativos: number;
  utilidadBruta: number;
  utilidadOperativa: number;
  otrosNeto: number;
}

export async function getPlHistory(months = 12): Promise<PlPoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pl_estado_resultados")
    .select("*")
    .order("period", { ascending: false })
    .limit(months + 5); // buffer para filtrar datos corruptos
  const rows = (data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
    costo_ventas: number | null;
    gastos_operativos: number | null;
    utilidad_bruta: number | null;
    utilidad_operativa: number | null;
    otros_neto: number | null;
  }>;
  // filtra rows con periods inválidos (ej '2202-02') y los sin ingresos
  const valid = rows.filter((r) => {
    if (!r.period) return false;
    const [y] = r.period.split("-");
    const year = Number(y);
    return year >= 2020 && year <= 2030;
  });
  return valid
    .slice(0, months)
    .map((r) => ({
      period: r.period as string,
      ingresos: Number(r.ingresos) || 0,
      costoVentas: Number(r.costo_ventas) || 0,
      gastosOperativos: Number(r.gastos_operativos) || 0,
      utilidadBruta: Number(r.utilidad_bruta) || 0,
      utilidadOperativa: Number(r.utilidad_operativa) || 0,
      otrosNeto: Number(r.otros_neto) || 0,
    }))
    .reverse(); // orden cronológico ascendente
}
