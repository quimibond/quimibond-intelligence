import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-PNL-NORM — P&L normalizado: separa operación core de ajustes year-end
 * y one-offs.
 *
 * Categorías detectadas (silver: get_pnl_normalization_adjustments):
 *  1. Venta de activo fijo (704.23.0003 + 701.01.0004) — siempre one-off
 *  2. Siniestros e incobrables (701.01.0003/05/06)
 *  3. Otros ingresos extraordinarios (704.23.0001 si > $500k)
 *  4. Ajuste inventario year-end (501.01.02 atípico — exceso vs 5x avg)
 *  5. Catch-up depreciación (504.08-23 + 613 atípico — exceso vs 3x avg)
 *
 * Reportado vs Normalizado:
 *   Normalizado = Reportado − Σ(impact_on_utility de cada ajuste detectado)
 *   "Impact" tiene sentido CFO: positivo = quitar este ajuste sube la
 *   utilidad normalizada (caso de gastos atípicos sobreestimados);
 *   negativo = quitarlo baja (caso de ingresos no recurrentes).
 */

export interface PnlAdjustment {
  category: string;
  categoryLabel: string;
  accountCodes: string[];
  amountMxn: number;          // monto bruto en stored sign (CFO display)
  impactOnUtilityMxn: number; // signo neto sobre utilidad si removemos el ajuste
  reason: string;
  detected: boolean;
}

export interface PnlNormalizedSummary {
  period: HistoryRange;
  periodLabel: string;
  reportedNetIncomeMxn: number;
  totalAdjustmentImpactMxn: number;
  normalizedNetIncomeMxn: number;
  adjustments: PnlAdjustment[];
}

type RpcRow = {
  category: string;
  category_label: string;
  account_codes: string[];
  amount_mxn: number | string | null;
  impact_on_utility_mxn: number | string | null;
  reason: string;
  detected: boolean | null;
};

async function _getPnlNormalizedRaw(
  range: HistoryRange
): Promise<PnlNormalizedSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const toMonth = bounds.toMonth.slice(0, 7);

  const [adjRes, plRes] = await Promise.all([
    sb.rpc("get_pnl_normalization_adjustments", {
      p_date_from: bounds.from,
      p_date_to: bounds.to,
    }),
    sb
      .from("gold_pl_statement")
      .select("net_income")
      .gte("period", bounds.fromMonth)
      .lte("period", toMonth),
  ]);

  type PlRow = { net_income: number | null };
  const plRows = (plRes.data ?? []) as PlRow[];
  const reportedNetIncomeMxn = -plRows.reduce(
    (s, r) => s + (Number(r.net_income) || 0),
    0
  );

  const adjustments: PnlAdjustment[] = ((adjRes.data ?? []) as RpcRow[]).map(
    (r) => ({
      category: r.category,
      categoryLabel: r.category_label,
      accountCodes: r.account_codes ?? [],
      amountMxn: Number(r.amount_mxn) || 0,
      impactOnUtilityMxn: Number(r.impact_on_utility_mxn) || 0,
      reason: r.reason,
      detected: Boolean(r.detected),
    })
  );

  const totalAdjustmentImpactMxn = adjustments
    .filter((a) => a.detected)
    .reduce((s, a) => s + a.impactOnUtilityMxn, 0);

  const normalizedNetIncomeMxn = reportedNetIncomeMxn + totalAdjustmentImpactMxn;

  return {
    period: range,
    periodLabel: bounds.label,
    reportedNetIncomeMxn: Math.round(reportedNetIncomeMxn * 100) / 100,
    totalAdjustmentImpactMxn:
      Math.round(totalAdjustmentImpactMxn * 100) / 100,
    normalizedNetIncomeMxn: Math.round(normalizedNetIncomeMxn * 100) / 100,
    adjustments,
  };
}

export const getPnlNormalized = (range: HistoryRange) =>
  unstable_cache(
    () => _getPnlNormalizedRaw(range),
    ["sp13-finanzas-pnl-normalized", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
