import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * CAPA workflow — calculadora del ajuste mensual a registrar en Odoo
 * para llevar 501.01.01 al costo MP real recursivo BOM.
 *
 * El residual = saldo 501.01.01 − costoPrimo BOM. Si > 0 hay que hacer
 * CAPA crediticia a 501.01.01 con débito a 504.01.0099 overhead.
 * Si < 0 (raro) hay que hacer CAPA inversa.
 *
 * Reporta también los CAPA ya posteados en el mes para que el monto
 * sugerido sea el "neto restante por aplicar".
 */

export interface CapaWorkflowMonth {
  period: string;                  // YYYY-MM
  cogs501_01_01_actualMxn: number; // saldo neto del mes (post cualquier CAPA aplicada)
  cogs501_01_01_grossMxn: number;  // saldo bruto sin la CAPA del mes (reconstruido)
  costoPrimoBomMxn: number;        // costo MP real recursivo
  capaAlreadyPostedMxn: number;    // suma de asientos del journal CAPA en el mes
  residualMxn: number;             // = gross − BOM (lo que SIN ajuste habría)
  pendingToPostMxn: number;        // = residual − capaAlreadyPosted
  status: "ok" | "pending_small" | "pending_large" | "over_corrected";
}

export interface CapaHistory {
  months: CapaWorkflowMonth[];      // últimos 12 meses, más reciente primero
  totalPendingMxn: number;          // suma de pendingToPost > 0 últimos 12 meses
}

async function _getCapaWorkflowHistoryRaw(
  upToPeriod: string,
  monthsBack = 12
): Promise<CapaHistory> {
  const sb = getServiceClient();

  // Compute the period range
  const [yE, mE] = upToPeriod.split("-").map((s) => parseInt(s, 10));
  const periods: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(yE, mE - 1 - i, 1);
    periods.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  const oldest = periods[periods.length - 1];

  // 1. Saldo neto 501.01.01 por mes (lo que ya está post cualquier CAPA)
  const balRes = await sb
    .from("canonical_account_balances")
    .select("period, balance")
    .eq("account_code", "501.01.01")
    .eq("deprecated", false)
    .gte("period", oldest)
    .lte("period", upToPeriod);
  type BalRow = { period: string; balance: number | null };
  const balByPeriod = new Map<string, number>(
    ((balRes.data ?? []) as BalRow[]).map((r) => [r.period, Number(r.balance) || 0])
  );

  // 2. CAPA already posted del journal "CAPA DE VALORACIÓN" por mes
  //    (sumamos todos los movimientos a 501.01.01 desde ese journal)
  const capaRes = await sb.rpc("get_capa_posted_per_month", {
    p_from_period: oldest,
    p_to_period: upToPeriod,
  });
  type CapaRow = { period: string; net_capa: number | string };
  const capaByPeriod = new Map<string, number>(
    ((capaRes.data ?? []) as CapaRow[]).map((r) => [
      r.period,
      Number(r.net_capa) || 0,
    ])
  );

  // 3. costo primo BOM por mes (cogs_monthly_cache)
  const cogsRes = await sb
    .from("cogs_monthly_cache")
    .select("period, cogs_recursive_mp_mxn")
    .gte("period", oldest)
    .lte("period", upToPeriod);
  type CogsRow = { period: string; cogs_recursive_mp_mxn: number | string | null };
  const bomByPeriod = new Map<string, number>(
    ((cogsRes.data ?? []) as CogsRow[]).map((r) => [
      r.period,
      Number(r.cogs_recursive_mp_mxn) || 0,
    ])
  );

  const months: CapaWorkflowMonth[] = periods.map((period) => {
    const actual = balByPeriod.get(period) ?? 0;
    const capaPosted = capaByPeriod.get(period) ?? 0;
    // Reconstruir el saldo "gross" pre-CAPA del mes
    // Nota: capaPosted es el net debit-credit a 501.01.01 desde journal CAPA
    // Si fue Cr 501.01.01 (reduce COGS), capaPosted es negativo.
    // Por tanto: gross = actual − capaPosted (revertimos la reducción)
    const gross = actual - capaPosted;
    const bom = bomByPeriod.get(period) ?? 0;
    const residual = gross - bom; // overhead inflado pre-CAPA
    const pendingToPost = residual + capaPosted; // si capaPosted es negativo, reduce el pendiente
    let status: CapaWorkflowMonth["status"] = "ok";
    if (Math.abs(pendingToPost) < 50000) status = "ok";
    else if (pendingToPost > 0 && pendingToPost < 500000)
      status = "pending_small";
    else if (pendingToPost >= 500000) status = "pending_large";
    else if (pendingToPost < -50000) status = "over_corrected";

    return {
      period,
      cogs501_01_01_actualMxn: Math.round(actual * 100) / 100,
      cogs501_01_01_grossMxn: Math.round(gross * 100) / 100,
      costoPrimoBomMxn: Math.round(bom * 100) / 100,
      capaAlreadyPostedMxn: Math.round(capaPosted * 100) / 100,
      residualMxn: Math.round(residual * 100) / 100,
      pendingToPostMxn: Math.round(pendingToPost * 100) / 100,
      status,
    };
  });

  const totalPendingMxn = months.reduce(
    (s, m) => s + Math.max(0, m.pendingToPostMxn),
    0
  );

  return {
    months,
    totalPendingMxn: Math.round(totalPendingMxn * 100) / 100,
  };
}

export const getCapaWorkflowHistory = (upToPeriod: string, monthsBack = 12) =>
  unstable_cache(
    () => _getCapaWorkflowHistoryRaw(upToPeriod, monthsBack),
    ["sp13-capa-workflow-history-v1", upToPeriod, String(monthsBack)],
    { revalidate: 600, tags: ["finanzas"] }
  )();
