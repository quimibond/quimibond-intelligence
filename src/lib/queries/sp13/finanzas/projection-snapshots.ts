import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { CashProjection, ProjectionEvent } from "./projection";

/**
 * F-SNAPSHOTS — Tracking de predicciones vs realidad.
 *
 * Cierra el loop de auto-aprendizaje. Hasta ahora:
 *   - Backtesting sobre history (canonical 12m + SAT 60m): aprendemos de
 *     comportamiento pasado.
 *   - Pero no medimos si las predicciones FUTURAS aciertan.
 *
 * Ahora:
 *   1. Cada día Vercel cron captura el cash projection actual y lo
 *      almacena en projection_snapshots agregado por semana × próximas 13.
 *   2. Cuando una semana objetivo ya pasó, computamos el actual real
 *      desde canonical_payments (inflows/outflows que efectivamente
 *      ocurrieron en esa semana).
 *   3. MAPE (mean absolute percent error) por componente nos dice
 *      cuán confiable es el modelo en práctica. Si MAPE < 15% → bien.
 *      Si MAPE > 30% → desviación importante, recalibrar.
 *
 * Esto cierra el loop de aprendizaje: predicción → captura → realidad
 * → métrica → ajuste de heurísticas.
 */

export interface SnapshotCaptureResult {
  snapshotDate: string;
  horizonDays: number;
  weeksCaptured: number;
  totalPredictedInflowMxn: number;
  totalPredictedOutflowMxn: number;
}

/** Helper: lunes de la semana de una fecha (ISO week start). */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Captura snapshot semanal del cash projection actual. Idempotente:
 * UPSERT por (snapshot_date, horizon_days, week_start) — re-corridas en
 * el mismo día actualizan en lugar de duplicar.
 */
export async function captureProjectionSnapshot(
  projection: CashProjection
): Promise<SnapshotCaptureResult> {
  const sb = getServiceClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const snapshotDate = toIso(today);

  // Agrupar eventos por semana (lunes-domingo)
  type WeekAgg = {
    weekStart: Date;
    weekEnd: Date;
    inflow: number;
    outflow: number;
    byCategory: Record<string, { inflow: number; outflow: number }>;
  };
  const byWeek = new Map<string, WeekAgg>();
  for (const ev of projection.events as ProjectionEvent[]) {
    const eventDate = new Date(ev.date);
    const wkStart = mondayOf(eventDate);
    const key = toIso(wkStart);
    const wkEnd = new Date(wkStart);
    wkEnd.setDate(wkEnd.getDate() + 6);
    const acc =
      byWeek.get(key) ??
      ({
        weekStart: wkStart,
        weekEnd: wkEnd,
        inflow: 0,
        outflow: 0,
        byCategory: {},
      } as WeekAgg);
    if (ev.kind === "inflow") {
      acc.inflow += ev.amountMxn;
    } else {
      acc.outflow += ev.amountMxn;
    }
    const cat = (acc.byCategory[ev.category] ?? { inflow: 0, outflow: 0 });
    if (ev.kind === "inflow") cat.inflow += ev.amountMxn;
    else cat.outflow += ev.amountMxn;
    acc.byCategory[ev.category] = cat;
    byWeek.set(key, acc);
  }

  // Construir rows para insert
  const rows = [...byWeek.values()].map((w) => ({
    snapshot_date: snapshotDate,
    horizon_days: projection.horizonDays,
    week_start: toIso(w.weekStart),
    week_end: toIso(w.weekEnd),
    predicted_inflow_mxn: Math.round(w.inflow),
    predicted_outflow_mxn: Math.round(w.outflow),
    predicted_net_mxn: Math.round(w.inflow - w.outflow),
    category_breakdown: w.byCategory,
  }));

  if (rows.length === 0) {
    return {
      snapshotDate,
      horizonDays: projection.horizonDays,
      weeksCaptured: 0,
      totalPredictedInflowMxn: 0,
      totalPredictedOutflowMxn: 0,
    };
  }

  // UPSERT: si re-capturamos en el mismo día, sobrescribir
  const { error } = await sb
    .from("projection_snapshots")
    .upsert(rows, {
      onConflict: "snapshot_date,horizon_days,week_start",
    });

  if (error) {
    throw new Error(
      `[captureProjectionSnapshot] upsert failed: ${error.message}`
    );
  }

  const totalIn = rows.reduce((s, r) => s + r.predicted_inflow_mxn, 0);
  const totalOut = rows.reduce((s, r) => s + r.predicted_outflow_mxn, 0);

  return {
    snapshotDate,
    horizonDays: projection.horizonDays,
    weeksCaptured: rows.length,
    totalPredictedInflowMxn: totalIn,
    totalPredictedOutflowMxn: totalOut,
  };
}

/**
 * Métricas de precisión del modelo: para cada snapshot pasado cuya
 * semana objetivo ya transcurrió, compara la predicción contra el
 * inflow/outflow real desde canonical_payments.
 */
export interface AccuracyComparisonRow {
  weekStart: string;
  weekEnd: string;
  // Predicción: capturada hace ~7d antes del inicio de esa semana
  predictedInflowMxn: number;
  predictedOutflowMxn: number;
  predictedNetMxn: number;
  // Realidad
  actualInflowMxn: number;
  actualOutflowMxn: number;
  actualNetMxn: number;
  // Errores
  errorInflowPct: number; // (actual - predicted) / predicted × 100
  errorOutflowPct: number;
  absErrorInflowPct: number;
  absErrorOutflowPct: number;
  // Lead time del snapshot (cuántos días antes del inicio de la semana
  // se hizo la captura). 1-week-out es más fácil de predecir.
  leadTimeDays: number;
}

export interface ProjectionAccuracySummary {
  rows: AccuracyComparisonRow[];
  /** MAPE inflow agregado en la ventana */
  mapeInflow: number;
  mapeOutflow: number;
  /** Bias: (actual - predicted) / predicted promedio (signed). Negative = modelo optimista */
  biasInflow: number;
  biasOutflow: number;
  weeksCompared: number;
  asOfDate: string;
}

async function _getProjectionAccuracyRaw(
  weeksBack = 12
): Promise<ProjectionAccuracySummary> {
  const sb = getServiceClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIso(today);

  // Window: últimas N semanas cuyo week_end < today (semana ya completa)
  const windowStartDate = new Date(today);
  windowStartDate.setDate(windowStartDate.getDate() - weeksBack * 7 - 7);
  const windowStartIso = toIso(windowStartDate);

  // Pull snapshots: para cada (week_start) en window, tomar el snapshot
  // más antiguo (lead time mayor) — eso mide la calidad de predicción
  // a 1+ semana de anticipación.
  const { data: snaps, error } = await sb
    .from("projection_snapshots")
    .select(
      "snapshot_date, horizon_days, week_start, week_end, predicted_inflow_mxn, predicted_outflow_mxn, predicted_net_mxn"
    )
    .gte("week_start", windowStartIso)
    .lt("week_end", todayIso)
    .order("snapshot_date", { ascending: true });

  if (error || !snaps) {
    return {
      rows: [],
      mapeInflow: 0,
      mapeOutflow: 0,
      biasInflow: 0,
      biasOutflow: 0,
      weeksCompared: 0,
      asOfDate: todayIso,
    };
  }

  // Para cada week_start, conservar el snapshot más antiguo (mayor lead time)
  type SnapRow = {
    snapshot_date: string;
    horizon_days: number;
    week_start: string;
    week_end: string;
    predicted_inflow_mxn: number;
    predicted_outflow_mxn: number;
    predicted_net_mxn: number;
  };
  const earliestByWeek = new Map<string, SnapRow>();
  for (const s of snaps as SnapRow[]) {
    const existing = earliestByWeek.get(s.week_start);
    if (!existing || s.snapshot_date < existing.snapshot_date) {
      earliestByWeek.set(s.week_start, s);
    }
  }

  const weekStarts = [...earliestByWeek.keys()].sort();
  if (weekStarts.length === 0) {
    return {
      rows: [],
      mapeInflow: 0,
      mapeOutflow: 0,
      biasInflow: 0,
      biasOutflow: 0,
      weeksCompared: 0,
      asOfDate: todayIso,
    };
  }

  // Pull actuals: canonical_payments en el rango de las semanas
  const minWeek = weekStarts[0];
  const maxWeekEnd = (() => {
    const last = earliestByWeek.get(weekStarts[weekStarts.length - 1])!;
    return last.week_end;
  })();
  const { data: payments } = await sb
    .from("canonical_payments")
    .select("direction, amount_mxn_resolved, payment_date_resolved")
    .gte("payment_date_resolved", minWeek)
    .lte("payment_date_resolved", maxWeekEnd)
    .gt("amount_mxn_resolved", 0);

  type PaymentRow = {
    direction: string | null;
    amount_mxn_resolved: number | null;
    payment_date_resolved: string | null;
  };
  const paymentsByWeek = new Map<string, { inflow: number; outflow: number }>();
  for (const p of (payments ?? []) as PaymentRow[]) {
    if (!p.payment_date_resolved) continue;
    const payDate = new Date(p.payment_date_resolved);
    const wkStart = toIso(mondayOf(payDate));
    const acc = paymentsByWeek.get(wkStart) ?? { inflow: 0, outflow: 0 };
    const amt = Number(p.amount_mxn_resolved) || 0;
    if (p.direction === "received" || p.direction === "inbound") acc.inflow += amt;
    else if (p.direction === "sent" || p.direction === "outbound") acc.outflow += amt;
    paymentsByWeek.set(wkStart, acc);
  }

  const rows: AccuracyComparisonRow[] = [];
  for (const ws of weekStarts) {
    const snap = earliestByWeek.get(ws)!;
    const actuals = paymentsByWeek.get(ws) ?? { inflow: 0, outflow: 0 };
    const errIn =
      snap.predicted_inflow_mxn !== 0
        ? ((actuals.inflow - snap.predicted_inflow_mxn) /
            snap.predicted_inflow_mxn) *
          100
        : 0;
    const errOut =
      snap.predicted_outflow_mxn !== 0
        ? ((actuals.outflow - snap.predicted_outflow_mxn) /
            snap.predicted_outflow_mxn) *
          100
        : 0;
    const leadDays = Math.floor(
      (new Date(ws).getTime() - new Date(snap.snapshot_date).getTime()) /
        86400000
    );
    rows.push({
      weekStart: ws,
      weekEnd: snap.week_end,
      predictedInflowMxn: Math.round(snap.predicted_inflow_mxn),
      predictedOutflowMxn: Math.round(snap.predicted_outflow_mxn),
      predictedNetMxn: Math.round(snap.predicted_net_mxn),
      actualInflowMxn: Math.round(actuals.inflow),
      actualOutflowMxn: Math.round(actuals.outflow),
      actualNetMxn: Math.round(actuals.inflow - actuals.outflow),
      errorInflowPct: Math.round(errIn * 10) / 10,
      errorOutflowPct: Math.round(errOut * 10) / 10,
      absErrorInflowPct: Math.round(Math.abs(errIn) * 10) / 10,
      absErrorOutflowPct: Math.round(Math.abs(errOut) * 10) / 10,
      leadTimeDays: leadDays,
    });
  }

  const mapeInflow =
    rows.length === 0
      ? 0
      : rows.reduce((s, r) => s + r.absErrorInflowPct, 0) / rows.length;
  const mapeOutflow =
    rows.length === 0
      ? 0
      : rows.reduce((s, r) => s + r.absErrorOutflowPct, 0) / rows.length;
  const biasInflow =
    rows.length === 0
      ? 0
      : rows.reduce((s, r) => s + r.errorInflowPct, 0) / rows.length;
  const biasOutflow =
    rows.length === 0
      ? 0
      : rows.reduce((s, r) => s + r.errorOutflowPct, 0) / rows.length;

  return {
    rows,
    mapeInflow: Math.round(mapeInflow * 10) / 10,
    mapeOutflow: Math.round(mapeOutflow * 10) / 10,
    biasInflow: Math.round(biasInflow * 10) / 10,
    biasOutflow: Math.round(biasOutflow * 10) / 10,
    weeksCompared: rows.length,
    asOfDate: todayIso,
  };
}

export const getProjectionAccuracy = (weeksBack = 12) =>
  unstable_cache(
    () => _getProjectionAccuracyRaw(weeksBack),
    ["sp13-finanzas-projection-accuracy-v1", weeksBack.toString()],
    { revalidate: 3600, tags: ["finanzas"] }
  )();
