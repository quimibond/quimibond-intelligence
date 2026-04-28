import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Audit 2026-04-27 finding #21: telemetría de latencia de cobro.
 *
 * `learned-params.ts` calcula medianas globales / per-counterparty para
 * usarlas en projection.ts, pero esa info no es visible al operador.
 * Una tendencia de "tardamos cada vez más en cobrar" puede ser invisible
 * por meses si no hay un chart explícito.
 *
 * Esta función agrupa por mes-de-pago la métrica
 *   delay_days = MAX(0, payment_date_odoo - due_date_resolved)
 * sobre canonical_invoices issued+paid de los últimos N meses, y
 * computa p50/p75/p90 + sample. UI: chart con 3 líneas + sample bar
 * en `/finanzas` debajo del aging calibration block.
 */

export interface CollectionLatencyMonth {
  /** YYYY-MM */
  month: string;
  /** Median (p50) days late */
  p50DelayDays: number;
  /** p75 days late */
  p75DelayDays: number;
  /** p90 days late */
  p90DelayDays: number;
  /** Total invoices contributing to this month */
  sampleSize: number;
}

export interface CollectionLatencyTrend {
  months: CollectionLatencyMonth[];
  /** Trend rate of p50 over the window: positive = empeorando, negative = mejorando.
   *  Slope simple via least-squares sobre los meses con sample >= 5. */
  p50TrendDaysPerMonth: number;
  /** Sample-weighted overall median across the window */
  overallP50Days: number;
  totalSample: number;
  asOfDate: string;
}

async function _getCollectionLatencyTrendRaw(
  monthsBack = 12
): Promise<CollectionLatencyTrend> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - monthsBack * 31 * 86400000);
  const startMonthIso = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;

  const PAGE = 1000;
  type Row = {
    due_date_resolved: string | null;
    payment_date_odoo: string | null;
  };
  const rows: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select("due_date_resolved, payment_date_odoo")
      .eq("direction", "issued")
      .eq("is_quimibond_relevant", true)
      .eq("payment_state_odoo", "paid")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .not("due_date_resolved", "is", null)
      .not("payment_date_odoo", "is", null)
      .gte("payment_date_odoo", startMonthIso)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const got = (data ?? []) as Row[];
    rows.push(...got);
    if (got.length < PAGE) break;
    offset += PAGE;
  }

  // Group by month-of-payment, accumulate delays
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.due_date_resolved || !r.payment_date_odoo) continue;
    const dueMs = new Date(r.due_date_resolved).getTime();
    const payMs = new Date(r.payment_date_odoo).getTime();
    const delay = Math.max(0, Math.floor((payMs - dueMs) / 86400000));
    const month = r.payment_date_odoo.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(delay);
    byMonth.set(month, arr);
  }

  const percentile = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
      sorted.length - 1,
      Math.floor((sorted.length - 1) * p)
    );
    return sorted[idx];
  };

  const months: CollectionLatencyMonth[] = [];
  const allDelays: number[] = [];
  for (const [month, delays] of byMonth) {
    const sorted = [...delays].sort((a, b) => a - b);
    months.push({
      month,
      p50DelayDays: percentile(sorted, 0.5),
      p75DelayDays: percentile(sorted, 0.75),
      p90DelayDays: percentile(sorted, 0.9),
      sampleSize: sorted.length,
    });
    allDelays.push(...sorted);
  }
  months.sort((a, b) => a.month.localeCompare(b.month));

  // Trend: pendiente de p50 sobre meses con sample >=5 (least-squares lineal).
  const trustedMonths = months.filter((m) => m.sampleSize >= 5);
  let trendSlope = 0;
  if (trustedMonths.length >= 3) {
    const n = trustedMonths.length;
    const xMean = (n - 1) / 2;
    const yValues = trustedMonths.map((m) => m.p50DelayDays);
    const yMean = yValues.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (yValues[i] - yMean);
      den += (i - xMean) ** 2;
    }
    trendSlope = den > 0 ? num / den : 0;
  }

  const sortedAll = [...allDelays].sort((a, b) => a - b);
  const overallP50 = percentile(sortedAll, 0.5);

  return {
    months,
    p50TrendDaysPerMonth: Math.round(trendSlope * 10) / 10,
    overallP50Days: overallP50,
    totalSample: allDelays.length,
    asOfDate: todayIso,
  };
}

export const getCollectionLatencyTrend = (monthsBack = 12) =>
  unstable_cache(
    () => _getCollectionLatencyTrendRaw(monthsBack),
    ["sp13-finanzas-collection-latency-v1", monthsBack.toString()],
    { revalidate: 3600, tags: ["finanzas"] }
  )();
