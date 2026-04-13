import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Dashboard queries v2 — usa las views canónicas del backend
 * (`cfo_dashboard`, `financial_runway`, `pl_estado_resultados`,
 *  `ops_delivery_health_weekly`, `customer_ltv_health`, `agent_insights`).
 *
 * Las views ya están normalizadas a MXN — nunca tocamos `odoo_invoices.amount_*`
 * directamente.
 */

export interface DashboardKpis {
  // Revenue del mes actual + trend (de pl_estado_resultados)
  ingresosMes: number;
  ingresosMesAnt: number;
  ingresosTrendPct: number;
  utilidadOperativaMes: number;
  // Cash y runway (de cfo_dashboard + financial_runway)
  efectivoNeto: number;
  runwayDias: number;
  burnDiario: number;
  // Cobranza (de cfo_dashboard)
  carteraVencida: number;
  clientesMorosos: number;
  // Ventas 30d
  ventas30d: number;
  cobros30d: number;
  // Insights
  insightsNew: number;
  insightsCritical: number;
  // Operaciones
  otdPct: number | null;
  // Clientes en riesgo
  atRiskCount: number;
  topAtRiskClients: Array<{
    company_id: number | null;
    company_name: string | null;
    tier: string | null;
    ltv_mxn: number | null;
    churn_risk_score: number | null;
    max_days_overdue: number | null;
  }>;
  lastUpdated: string;
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const sb = getServiceClient();

  const [
    cfo,
    runway,
    plHistory,
    insightsNew,
    insightsCritical,
    otd,
    ltv,
    atRiskCountRes,
  ] = await Promise.all([
    sb.from("cfo_dashboard").select("*").maybeSingle(),
    sb.from("financial_runway").select("*").maybeSingle(),
    sb
      .from("pl_estado_resultados")
      .select("period, ingresos, utilidad_operativa")
      .order("period", { ascending: false })
      .limit(24),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("state", "new"),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("state", "new")
      .eq("severity", "critical"),
    sb
      .from("ops_delivery_health_weekly")
      .select("otd_pct, week_start")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("customer_ltv_health")
      .select(
        "company_id, company_name, tier, ltv_mxn, churn_risk_score, max_days_overdue"
      )
      .gt("churn_risk_score", 70)
      .gt("ltv_mxn", 100_000)
      .order("churn_risk_score", { ascending: false })
      .limit(5),
    sb
      .from("customer_ltv_health")
      .select("company_id", { count: "exact", head: true })
      .gt("churn_risk_score", 70)
      .gt("ltv_mxn", 100_000),
  ]);

  // PL rows cleaned: filter invalid years, sort ascending, take current+prev month
  const plValid = ((plHistory.data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
    utilidad_operativa: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const year = Number(r.period.split("-")[0]);
      return year >= 2020 && year <= 2030;
    })
    .sort((a, b) => (b.period as string).localeCompare(a.period as string));

  const currentMonth = new Date();
  const currentKey = `${currentMonth.getFullYear()}-${String(
    currentMonth.getMonth() + 1
  ).padStart(2, "0")}`;
  const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  const currRow = plValid.find((r) => r.period === currentKey);
  const prevRow = plValid.find((r) => r.period === prevKey);

  const ingresosMes = Number(currRow?.ingresos) || 0;
  const ingresosMesAnt = Number(prevRow?.ingresos) || 0;
  const ingresosTrendPct =
    ingresosMesAnt > 0
      ? ((ingresosMes - ingresosMesAnt) / ingresosMesAnt) * 100
      : 0;
  const utilidadOperativaMes = Number(currRow?.utilidad_operativa) || 0;

  const cfoData = (cfo.data ?? {}) as {
    efectivo_disponible: number | null;
    deuda_tarjetas: number | null;
    posicion_neta: number | null;
    cuentas_por_cobrar: number | null;
    cuentas_por_pagar: number | null;
    cartera_vencida: number | null;
    ventas_30d: number | null;
    cobros_30d: number | null;
    clientes_morosos: number | null;
  };

  const runwayData = (runway.data ?? {}) as {
    cash_mxn: number | null;
    runway_days_net: number | null;
    burn_rate_daily: number | null;
  };

  return {
    ingresosMes,
    ingresosMesAnt,
    ingresosTrendPct,
    utilidadOperativaMes,
    efectivoNeto: Number(runwayData.cash_mxn) || 0,
    runwayDias: Number(runwayData.runway_days_net) || 0,
    burnDiario: Number(runwayData.burn_rate_daily) || 0,
    carteraVencida: Number(cfoData.cartera_vencida) || 0,
    clientesMorosos: Number(cfoData.clientes_morosos) || 0,
    ventas30d: Number(cfoData.ventas_30d) || 0,
    cobros30d: Number(cfoData.cobros_30d) || 0,
    insightsNew: insightsNew.count ?? 0,
    insightsCritical: insightsCritical.count ?? 0,
    otdPct: (otd.data as { otd_pct: number | null } | null)?.otd_pct ?? null,
    atRiskCount: atRiskCountRes.count ?? 0,
    topAtRiskClients: (ltv.data ?? []) as DashboardKpis["topAtRiskClients"],
    lastUpdated: new Date().toISOString(),
  };
}

export interface MonthlyRevenuePoint {
  period: string;
  revenue: number;
}

/**
 * Revenue mensual histórico desde `pl_estado_resultados` (ingresos reales
 * por periodo, limpiados de bad years).
 */
export async function getRevenueTrend(
  months = 12
): Promise<MonthlyRevenuePoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("pl_estado_resultados")
    .select("period, ingresos")
    .order("period", { ascending: false })
    .limit(months + 5);

  const rows = ((data ?? []) as Array<{
    period: string | null;
    ingresos: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const year = Number(r.period.split("-")[0]);
      return year >= 2020 && year <= 2030;
    })
    .slice(0, months)
    .map((r) => ({
      period: r.period as string,
      revenue: Number(r.ingresos) || 0,
    }))
    .reverse();

  return rows;
}
