/**
 * Audit 2026-04-27 finding #21: telemetría de latencia de cobro.
 *
 * Bloque server-rendered debajo del aging calibration. Muestra mes a mes
 * el p50/p75/p90 de delay (días entre due_date y payment_date_odoo) sobre
 * facturas issued+paid de los últimos 12 meses. Trend slope (días/mes)
 * en el header indica si Quimibond está cobrando más rápido (negativo)
 * o más lento (positivo) en el tiempo.
 *
 * Cliente para chart, server para fetch + transform.
 */
import { getCollectionLatencyTrend } from "@/lib/queries/sp13/finanzas";
import { CollectionLatencyChart } from "../collection-latency-chart";

export async function CollectionLatencyBlock() {
  const trend = await getCollectionLatencyTrend(12);
  if (trend.totalSample === 0) return null;

  const trendLabel =
    trend.p50TrendDaysPerMonth > 1
      ? `Empeorando: +${trend.p50TrendDaysPerMonth} días/mes (mediana)`
      : trend.p50TrendDaysPerMonth < -1
        ? `Mejorando: ${trend.p50TrendDaysPerMonth} días/mes (mediana)`
        : "Estable";

  const trendColor =
    trend.p50TrendDaysPerMonth > 1
      ? "text-destructive"
      : trend.p50TrendDaysPerMonth < -1
        ? "text-success"
        : "text-muted-foreground";

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-xs sm:px-4">
        <div className="font-semibold uppercase tracking-wide text-muted-foreground">
          Latencia de cobro · últimos 12 meses
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className={`font-medium ${trendColor}`}>{trendLabel}</span>
          <span className="text-muted-foreground">
            mediana global:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {trend.overallP50Days}d
            </span>
          </span>
          <span className="text-muted-foreground">
            n={trend.totalSample.toLocaleString("es-MX")}
          </span>
        </div>
      </div>
      <div className="px-3 py-3 sm:px-4">
        <CollectionLatencyChart months={trend.months} />
      </div>
      <div className="border-t bg-muted/10 px-3 py-2 text-[11px] leading-snug text-muted-foreground sm:px-4">
        Días entre due date y payment date sobre facturas pagadas. p50 es la
        mediana, p75/p90 capturan la cola larga (clientes que pagan tarde).
        Trend &gt;1d/mes indica deterioro estructural — vigilar AR de top
        clientes.
      </div>
    </div>
  );
}
