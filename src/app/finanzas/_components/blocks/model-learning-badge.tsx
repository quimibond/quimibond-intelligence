/**
 * Badge mostrando que el modelo aprende del histórico.
 *
 * Visible debajo de la tabla de top clientes en /finanzas → Proyección.
 * Da al CEO transparencia de qué tan entrenado está el modelo:
 *   - # facturas calibradas (sample del backtest aging)
 *   - # contrapartes con 12m precise (canonical)
 *   - # contrapartes con 5y SAT history + total years available
 *   - Tasa cobro fresh real vs heurística asumida
 */
export function ModelLearningBadge({
  learning,
}: {
  learning: {
    canonicalSampleSize: number;
    canonicalCounterparties: number;
    satCounterparties: number;
    satOldestRecord: string;
    freshPaymentRate: number;
    freshHeuristicRate: number;
    asOfDate: string;
  };
}) {
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const yearsOfHistory = (() => {
    if (!learning.satOldestRecord) return 0;
    const oldest = new Date(learning.satOldestRecord);
    return Math.max(0, Math.round((Date.now() - oldest.getTime()) / (365 * 86400000)));
  })();
  const calibrationDelta =
    learning.freshPaymentRate - learning.freshHeuristicRate;
  const calibrationLabel =
    calibrationDelta >= 0.01
      ? `+${fmtPct(calibrationDelta)} mejor que heurística`
      : calibrationDelta <= -0.01
        ? `${fmtPct(calibrationDelta)} peor que heurística`
        : "calibrado a heurística";

  return (
    <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-info">
          🧠 Modelo entrenado del histórico
        </span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.canonicalSampleSize.toLocaleString("es-MX")}
          </span>{" "}
          facturas calibradas
        </span>
        <span>·</span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.canonicalCounterparties.toLocaleString("es-MX")}
          </span>{" "}
          contrapartes 12m
        </span>
        <span>·</span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.satCounterparties.toLocaleString("es-MX")}
          </span>{" "}
          en SAT 5y ({yearsOfHistory}y total)
        </span>
        <span>·</span>
        <span>
          Cobro fresh real:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {fmtPct(learning.freshPaymentRate)}
          </span>{" "}
          ({calibrationLabel})
        </span>
      </div>
      <div className="mt-1 leading-snug">
        Probabilidades de recurrencia, delays y trends por contraparte se
        recalculan cada hora desde la última data. Cada nueva factura mejora
        el modelo automáticamente.
      </div>
    </div>
  );
}
