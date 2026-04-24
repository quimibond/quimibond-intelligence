import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-WTM — ¿Dónde está el dinero? Reconciliación de flujo de efectivo.
 *
 * Pregunta: "la utilidad dice $X pero no tengo cash, ¿dónde se fue?".
 * Respuesta: el Δ cash entre dos cortes (inicio vs fin del período) =
 * net income ± cambios en balance sheet (AR, inventario, AP, activo
 * fijo, deuda, equity).
 *
 * Fórmula:
 *   Δ cash = net income
 *          + depreciación (non-cash, suma de vuelta)
 *          − ΔAR  (si AR sube, cash no entró)
 *          − ΔInventario  (dinero atorado)
 *          − ΔPagos anticipados
 *          − ΔActivo fijo  (CAPEX)
 *          + ΔAP
 *          + ΔOtros pasivos
 *          + ΔDeuda
 *          + ΔEquity (excluyendo net income del período = retiros si −)
 *
 * RPC silver: get_cash_reconciliation(from_period, to_period).
 * Retorna saldos acumulados por category y delta.
 */

export type CashFlowDirection = "source" | "use";

export interface CashCategoryRow {
  category: string;
  categoryLabel: string;
  openingMxn: number;
  closingMxn: number;
  deltaMxn: number;
  cashFlowDirection: CashFlowDirection;
}

export interface CashReconciliation {
  period: HistoryRange;
  periodLabel: string;
  fromPeriod: string; // '2024-12'
  toPeriod: string;   // '2025-12'
  rows: CashCategoryRow[];
  netIncomeMxn: number;
  openingCashMxn: number;
  closingCashMxn: number;
  deltaCashMxn: number;
  // Reconciliación: suma de fuentes vs usos (excluyendo cash)
  sourcesMxn: number;
  usesMxn: number;
  equityWithdrawalsMxn: number; // Δequity − net_income_del_período (estimado)
}

type RpcRow = {
  category: string;
  category_label: string;
  prefix_pattern: string;
  opening_mxn: number | string;
  closing_mxn: number | string;
  delta_mxn: number | string;
  cash_flow_direction: CashFlowDirection;
};

function priorMonthLabel(periodYYYYMM: string): string {
  const [y, m] = periodYYYYMM.split("-").map((x) => parseInt(x, 10));
  const prior = new Date(y, m - 2, 1);
  const py = prior.getFullYear();
  const pm = String(prior.getMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
}

async function _getCashReconciliationRaw(
  range: HistoryRange
): Promise<CashReconciliation> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  // toMonth ya viene como mes inclusivo (fix lastInclusiveMonth)
  const toPeriod = bounds.toMonth.slice(0, 7);
  const fromPeriod = priorMonthLabel(bounds.fromMonth);

  const [reconcRes, plMonthsRes] = await Promise.all([
    sb.rpc("get_cash_reconciliation", {
      p_from_period: fromPeriod,
      p_to_period: toPeriod,
    }),
    // Net income del período: leer de gold_pl_statement (agregado por mes,
    // <100 rows, no se trunca). Antes leía rows individuales de
    // canonical_account_balances y PostgREST cortaba a 1000 rows con
    // rangos largos (>4 meses), produciendo net_income subestimado.
    sb
      .from("gold_pl_statement")
      .select("period, net_income")
      .gte("period", bounds.fromMonth)
      .lte("period", toPeriod),
  ]);

  type PlMonth = { period: string; net_income: number | null };
  const plRows = (plMonthsRes.data ?? []) as PlMonth[];
  // gold_pl_statement.net_income está en convención stored:
  //   POSITIVO = pérdida, NEGATIVO = utilidad (misma que canonical)
  // Negate para display CFO-normal (utilidad positiva, pérdida negativa).
  const netIncomeMxn = -plRows.reduce(
    (s, r) => s + (Number(r.net_income) || 0),
    0
  );

  const rows: CashCategoryRow[] = (
    (reconcRes.data ?? []) as RpcRow[]
  ).map((r) => ({
    category: r.category,
    categoryLabel: r.category_label,
    openingMxn: Number(r.opening_mxn) || 0,
    closingMxn: Number(r.closing_mxn) || 0,
    deltaMxn: Number(r.delta_mxn) || 0,
    cashFlowDirection: r.cash_flow_direction,
  }));

  const cashRow = rows.find((r) => r.category === "cash");
  const openingCashMxn = cashRow?.openingMxn ?? 0;
  const closingCashMxn = cashRow?.closingMxn ?? 0;
  const deltaCashMxn = cashRow?.deltaMxn ?? 0;

  // Equity withdrawals = NetIncome del período − Δequity
  // (si equity subió menos que el net income, hubo retiros)
  const equityRow = rows.find((r) => r.category === "equity");
  const equityDelta = equityRow?.deltaMxn ?? 0;
  const equityWithdrawalsMxn = netIncomeMxn - equityDelta;

  // Fuentes: deltas positivos en AP, current_liab, debt, equity_increase
  // y negativos en asset (AR baja = cash entró)
  let sources = netIncomeMxn; // utilidad es una fuente
  let uses = 0;
  for (const row of rows) {
    if (row.category === "cash") continue;
    if (row.category === "equity") {
      // Equity: delta ya incluye net_income. Si equity subió más que NI,
      // hubo aportaciones; si menos, hubo retiros (uso de cash).
      if (equityWithdrawalsMxn > 0) uses += equityWithdrawalsMxn;
      else sources += -equityWithdrawalsMxn;
      continue;
    }
    if (row.cashFlowDirection === "source") {
      // Si pasivo subió → liberó cash (source)
      if (row.deltaMxn > 0) sources += row.deltaMxn;
      else uses += -row.deltaMxn;
    } else {
      // Si activo subió → consumió cash (use)
      if (row.deltaMxn > 0) uses += row.deltaMxn;
      else sources += -row.deltaMxn;
    }
  }

  return {
    period: range,
    periodLabel: bounds.label,
    fromPeriod,
    toPeriod,
    rows,
    netIncomeMxn: Math.round(netIncomeMxn * 100) / 100,
    openingCashMxn: Math.round(openingCashMxn * 100) / 100,
    closingCashMxn: Math.round(closingCashMxn * 100) / 100,
    deltaCashMxn: Math.round(deltaCashMxn * 100) / 100,
    sourcesMxn: Math.round(sources * 100) / 100,
    usesMxn: Math.round(uses * 100) / 100,
    equityWithdrawalsMxn: Math.round(equityWithdrawalsMxn * 100) / 100,
  };
}

export const getCashReconciliation = (range: HistoryRange) =>
  unstable_cache(
    () => _getCashReconciliationRaw(range),
    ["sp13-finanzas-cash-reconciliation", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
