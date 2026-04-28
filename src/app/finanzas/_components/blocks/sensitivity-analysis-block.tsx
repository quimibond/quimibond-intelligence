import Link from "next/link";

import { formatCurrencyMXN } from "@/lib/formatters";
import {
  type CashProjection,
  type SensitivitySnapshot,
} from "@/lib/queries/sp13/finanzas";

/**
 * Sensitivity + Monte Carlo sobre el cash projection.
 *
 * Banda p10-p90 con 500 simulaciones aplicando multiplicadores N(1, σ)
 * a cada componente del cashflow. σ depende de volatilidad típica:
 *   - run rate clientes/proveedores: 15% (más volátil)
 *   - AR/SO/AP weighted: 10%
 *   - Recurrentes operativos (nómina/renta/SAT): 5% (estables)
 *
 * Tornado chart: top 8 variables por |impacto en closing| de un shock ±10%.
 */
export function SensitivityAnalysisBlock({
  projection,
  sens,
}: {
  projection: CashProjection;
  sens: SensitivitySnapshot;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);

  const top = sens.sensitivity.slice(0, 8);
  const maxAbs = top.reduce((m, r) => Math.max(m, r.absImpactMxn), 1);
  const range = sens.monteCarlo.closingP90Mxn - sens.monteCarlo.closingP10Mxn;
  const rangePct =
    sens.baselineClosingMxn !== 0
      ? (range / Math.abs(sens.baselineClosingMxn)) * 100
      : 0;

  return (
    <details className="overflow-hidden rounded-md border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/40 sm:px-4 [&::-webkit-details-marker]:hidden">
        <span>Sensibilidad + Monte Carlo · banda p10-p90</span>
        <span className="font-normal normal-case tracking-normal">
          {sens.monteCarlo.iterations.toLocaleString("es-MX")} simulaciones ·
          banda ±{Math.round(rangePct)}% del baseline
        </span>
      </summary>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        <div className="rounded-md border bg-muted/10 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Distribución del closing balance ({sens.horizonDays}d) — 500 escenarios
            con multiplicadores N(1, σ=10-15%) sobre cada componente
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Pesimista (p10)
              </div>
              <div className="text-base font-semibold tabular-nums text-destructive">
                {fmt(sens.monteCarlo.closingP10Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Conservador (p25)
              </div>
              <div className="text-sm font-medium tabular-nums text-warning">
                {fmt(sens.monteCarlo.closingP25Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Mediana (p50)
              </div>
              <div className="text-sm font-medium tabular-nums">
                {fmt(sens.monteCarlo.closingP50Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Probable alto (p75)
              </div>
              <div className="text-sm font-medium tabular-nums text-info">
                {fmt(sens.monteCarlo.closingP75Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Optimista (p90)
              </div>
              <div className="text-base font-semibold tabular-nums text-success">
                {fmt(sens.monteCarlo.closingP90Mxn)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Baseline (modelo punto): {fmt(sens.baselineClosingMxn)}.{" "}
            {sens.monteCarlo.probBelowSafetyFloor > 0 && (
              <span className="text-warning">
                {sens.monteCarlo.probBelowSafetyFloor.toFixed(1)}% probabilidad
                de cruzar el piso de seguridad ({fmt(sens.safetyFloor)}).
              </span>
            )}
            {sens.monteCarlo.probNegativeClosing > 0 && (
              <span className="ml-1 text-destructive">
                {sens.monteCarlo.probNegativeClosing.toFixed(1)}% probabilidad
                de closing negativo.
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            ¿Qué variable mueve más la aguja? (impacto en closing por shock ±10%)
          </div>
          <div className="space-y-1">
            {top.map((r) => {
              const widthPct = (r.absImpactMxn / maxAbs) * 100;
              const isPositive = r.direction === "positive";
              return (
                <div
                  key={r.variable}
                  className="grid items-center gap-2"
                  style={{ gridTemplateColumns: "180px 1fr 100px" }}
                >
                  <div className="text-xs" title={r.description}>
                    {r.label}
                  </div>
                  <div className="relative h-4 rounded-sm bg-muted">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-sm ${isPositive ? "bg-success/60" : "bg-destructive/60"}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div
                    className={`text-right text-xs tabular-nums ${isPositive ? "text-success" : "text-destructive"}`}
                    title={fmtFull(r.componentMxn)}
                  >
                    {isPositive ? "+" : "−"}
                    {fmt(r.absImpactMxn)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Verde = inflow (su shock +10% sube el closing). Rojo = outflow
            (su shock +10% baja el closing). Las top 3 son donde más impacta
            la incertidumbre — vale la pena monitorear esas más de cerca.
          </div>
        </div>

        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-info">
            Cómo interpretar la banda
          </span>{" "}
          La proyección punto ({fmt(sens.baselineClosingMxn)}) es solo un
          escenario base. Si los parámetros se desvían dentro de su
          variación histórica típica (±10-15% por categoría), el closing
          real puede caer entre {fmt(sens.monteCarlo.closingP10Mxn)} y{" "}
          {fmt(sens.monteCarlo.closingP90Mxn)} con 80% de probabilidad. La
          banda es ancha cuando hay mucha incertidumbre concentrada en
          pocas variables — el tornado de arriba muestra cuáles.
        </div>
        <div className="flex justify-end">
          <Link
            href={`/finanzas/scenarios?proj_horizon=${sens.horizonDays}`}
            className="inline-flex items-center gap-1 rounded border border-info/40 bg-info/10 px-2 py-1 text-[11px] font-medium text-info hover:bg-info/20"
          >
            Construir escenarios manuales →
          </Link>
        </div>
      </div>
    </details>
  );
}
