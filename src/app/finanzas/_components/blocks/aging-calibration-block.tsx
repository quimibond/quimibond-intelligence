/**
 * Audit 2026-04-27 finding #19: backtest dashboard de aging buckets.
 *
 * Compara las heurísticas hardcoded del cashflow_projection (95/85/70/50/25)
 * contra la tasa REAL observada en los últimos 18m de canonical_invoices.
 * Cada cliente con histórico ya recibe override personalizado (#9), pero
 * este dashboard expone la calibración global del modelo para el operador.
 *
 * Lectura: si el bucket "fresh" muestra "real 87% vs hardcoded 95%",
 * significa que en promedio Quimibond cobra 87% de las facturas no
 * vencidas (no 95%). El operador puede usarlo para sanity-check del
 * pipeline o para detectar deterioro estructural en cobranza.
 */
import { getLearnedAgingCalibration } from "@/lib/queries/sp13/finanzas";

const BUCKET_LABELS: Record<string, { label: string; hardcoded: number }> = {
  fresh: { label: "Fresca (no vencida)", hardcoded: 0.95 },
  overdue_1_30: { label: "1-30 días vencida", hardcoded: 0.85 },
  overdue_31_60: { label: "31-60 días", hardcoded: 0.7 },
  overdue_61_90: { label: "61-90 días", hardcoded: 0.5 },
  overdue_90_plus: { label: "90+ días", hardcoded: 0.25 },
};

export async function AgingCalibrationBlock() {
  const cal = await getLearnedAgingCalibration();
  const totalSample = cal.totalSample;
  if (totalSample === 0) return null;

  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const buckets = Object.entries(cal.paymentRateByBucket).map(([key, b]) => {
    const meta = BUCKET_LABELS[key];
    if (!meta) return null;
    const delta = b.rate - meta.hardcoded;
    const deltaSign = delta >= 0 ? "+" : "";
    return {
      key,
      label: meta.label,
      hardcoded: meta.hardcoded,
      real: b.rate,
      sampleSize: b.sampleSize,
      delta,
      deltaPctStr: `${deltaSign}${(delta * 100).toFixed(1)}pp`,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // Override count: cuántos clientes tienen calibración personalizada (#9).
  // perCustomerByBronzeId es Record<string, ...> (no Map) por cache safety.
  const perCustCount = Object.keys(cal.perCustomerByBronzeId ?? {}).length;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
        Backtest aging buckets · últimos 18 meses ({totalSample.toLocaleString("es-MX")} facturas)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium sm:px-4">Bucket</th>
              <th className="px-3 py-2 text-right font-medium">Heurística</th>
              <th className="px-3 py-2 text-right font-medium">Real (Quimibond)</th>
              <th className="px-3 py-2 text-right font-medium">Δ</th>
              <th className="px-3 py-2 text-right font-medium">n</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const sigDelta = Math.abs(b.delta) >= 0.03; // 3pp = significativo
              const deltaColor = !sigDelta
                ? "text-muted-foreground"
                : b.delta > 0
                  ? "text-success"
                  : "text-destructive";
              const trustLow = b.sampleSize < 10;
              return (
                <tr key={b.key} className="border-t">
                  <td className="px-3 py-2 sm:px-4">{b.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtPct(b.hardcoded)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtPct(b.real)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaColor}`}>
                    {b.deltaPctStr}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${trustLow ? "text-warning" : "text-muted-foreground"}`}>
                    {b.sampleSize.toLocaleString("es-MX")}
                    {trustLow && " ⚠"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t bg-muted/10 px-3 py-2 text-[11px] leading-snug text-muted-foreground sm:px-4">
        Δ = real − heurística (puntos porcentuales). Verde = cobro mejor del
        esperado, rojo = peor. {perCustCount.toLocaleString("es-MX")} clientes con
        calibración personalizada (override del global con shrinkage Bayesiano cuando hay
        ≥4 facturas con outcome). ⚠ = sample &lt;10 (poco confiable, usar
        heurística).
      </div>
    </div>
  );
}
