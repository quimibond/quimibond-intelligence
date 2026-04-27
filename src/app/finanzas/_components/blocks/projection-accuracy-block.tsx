import { formatCurrencyMXN } from "@/lib/formatters";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getProjectionAccuracy,
  type AccuracyComparisonRow,
} from "@/lib/queries/sp13/finanzas";

/**
 * F-ACCURACY — MAPE + bias del modelo de cash projection.
 * Compara predicciones snapshoteadas (cron diario) vs canonical_payments reales.
 */
export async function ProjectionAccuracyBlock() {
  const acc = await getProjectionAccuracy(12);
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  if (acc.weeksCompared === 0) {
    return (
      <QuestionSection
        id="model-accuracy"
        question="¿Qué tan confiable ha sido el modelo?"
        subtext="Acumulando data — comparativos predicción vs realidad aparecerán aquí
          después de la primera semana cerrada (snapshot diario via cron 06:00)."
        collapsible
        defaultOpen={false}
      >
        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-3 text-xs text-muted-foreground">
          <span className="font-semibold text-info">Captura iniciada hoy.</span>{" "}
          El cron diario captura las próximas 13 semanas del cash projection.
          Cuando una semana objetivo ya transcurrió, se compara el monto
          predicho vs el flujo real (canonical_payments) y se calcula el
          error. Cierra el loop de auto-aprendizaje: el sistema sabrá si
          está mejorando o degradándose con el tiempo.
        </div>
      </QuestionSection>
    );
  }

  const inflowBiasLabel =
    acc.biasInflow > 5
      ? "modelo conservador (real > predicho)"
      : acc.biasInflow < -5
        ? "modelo optimista (real < predicho)"
        : "calibrado";
  const outflowBiasLabel =
    acc.biasOutflow > 5
      ? "modelo conservador (pago real > predicho)"
      : acc.biasOutflow < -5
        ? "modelo optimista (pago real < predicho)"
        : "calibrado";

  const mapeTone = (mape: number): "success" | "warning" | "danger" => {
    if (mape <= 15) return "success";
    if (mape <= 30) return "warning";
    return "danger";
  };

  return (
    <QuestionSection
      id="model-accuracy"
      question="¿Qué tan confiable ha sido el modelo?"
      subtext={`MAPE (mean absolute percent error) sobre las últimas
        ${acc.weeksCompared} semanas cerradas. Compara la predicción
        capturada por el cron diario vs los flujos reales registrados
        (canonical_payments). MAPE bajo = modelo confiable. MAPE alto =
        recalibrar heurísticas. Bias positivo = modelo conservador,
        bias negativo = modelo optimista.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard title="MAPE inflow" value={acc.mapeInflow} format="percent" tone={mapeTone(acc.mapeInflow)} subtitle={`${acc.weeksCompared} semanas comparadas`} />
        <KpiCard title="MAPE outflow" value={acc.mapeOutflow} format="percent" tone={mapeTone(acc.mapeOutflow)} subtitle="Error absoluto pagos" />
        <KpiCard title="Bias inflow" value={acc.biasInflow} format="percent" tone={Math.abs(acc.biasInflow) <= 5 ? "success" : "warning"} subtitle={inflowBiasLabel} />
        <KpiCard title="Bias outflow" value={acc.biasOutflow} format="percent" tone={Math.abs(acc.biasOutflow) <= 5 ? "success" : "warning"} subtitle={outflowBiasLabel} />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Comparativo semana × semana
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Inflow predicho</TableHead>
                <TableHead className="text-right">Inflow real</TableHead>
                <TableHead className="text-right">Error</TableHead>
                <TableHead className="text-right">Outflow predicho</TableHead>
                <TableHead className="text-right">Outflow real</TableHead>
                <TableHead className="text-right">Error</TableHead>
                <TableHead className="text-right">Lead time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {acc.rows.map((r: AccuracyComparisonRow) => {
                const inErrTone =
                  Math.abs(r.errorInflowPct) <= 15 ? "text-success"
                  : Math.abs(r.errorInflowPct) <= 30 ? "text-warning"
                  : "text-destructive";
                const outErrTone =
                  Math.abs(r.errorOutflowPct) <= 15 ? "text-success"
                  : Math.abs(r.errorOutflowPct) <= 30 ? "text-warning"
                  : "text-destructive";
                return (
                  <TableRow key={r.weekStart}>
                    <TableCell className="font-medium">{r.weekStart}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.predictedInflowMxn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.actualInflowMxn)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${inErrTone}`}>
                      {r.errorInflowPct > 0 ? "+" : ""}{r.errorInflowPct.toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.predictedOutflowMxn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.actualOutflowMxn)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${outErrTone}`}>
                      {r.errorOutflowPct > 0 ? "+" : ""}{r.errorOutflowPct.toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {r.leadTimeDays}d
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se mide</span>{" "}
        El cron 06:00 captura cada día las próximas 13 semanas del cash
        projection. Para cada semana cerrada, tomamos el snapshot MÁS
        ANTIGUO (mayor lead time) — eso mide la calidad de predicción a
        1+ semana de anticipación, no &quot;same-day&quot;. Inflow real =
        sum canonical_payments direction=received. Outflow real =
        direction=sent. MAPE &lt;15% = modelo confiable, 15-30% = ajuste
        moderado, &gt;30% = recalibrar. Bias informa si la heurística está
        sistemáticamente alta o baja.
      </div>
    </QuestionSection>
  );
}
