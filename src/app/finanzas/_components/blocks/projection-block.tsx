import { AlertTriangle } from "lucide-react";
import {
  QuestionSection,
  Currency,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  getCashProjection,
  type CashFlowCategoryTotal,
} from "@/lib/queries/sp13/finanzas";
import { CashProjectionChart } from "../cash-projection-chart";
import { ProjectionHorizonSelector } from "../projection-horizon-selector";
import { CustomerInflowBreakdownTable } from "./customer-inflow-breakdown-table";
import { SensitivityAnalysisBlock } from "./sensitivity-analysis-block";
import { ModelLearningBadge } from "./model-learning-badge";
import { ProjectionTimeline } from "./projection-timeline";

/* ── F5 Projection ───────────────────────────────────────────────────── */
export async function ProjectionBlock({ horizon }: { horizon: 13 | 30 | 90 }) {
  const proj = await getCashProjection(horizon);
  const belowFloor = proj.minBalance < proj.safetyFloor;

  return (
    <QuestionSection
      id="projection"
      question="¿Qué va a pasar con el efectivo?"
      subtext={
        proj.avgCollectionProbability != null
          ? `Saldo proyectado · AR ponderado por probabilidad histórica (avg ${Math.round(proj.avgCollectionProbability * 100)}%)`
          : "Saldo proyectado basado en due dates del AR/AP abierto"
      }
      actions={<ProjectionHorizonSelector paramName="proj_horizon" value={horizon} />}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryStat
          label="Saldo inicial"
          value={proj.openingBalance}
          stale={proj.openingBalanceStale}
          staleHours={proj.openingBalanceStaleHours}
        />
        <SummaryStat
          label="Entradas esperadas"
          value={proj.totalInflow}
          positive
        />
        <SummaryStat
          label="Salidas programadas"
          value={proj.totalOutflow}
          negative
        />
        <SummaryStat
          label="Saldo proyectado"
          value={proj.closingBalance}
          highlight={belowFloor}
        />
      </div>

      {proj.openingBalanceStale && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
          <span className="font-semibold">Saldo bancario stale:</span> última
          actualización hace {proj.openingBalanceStaleHours}h. El sync de
          banco lleva más de 48h sin refrescar — el saldo proyectado se
          calcula sobre un punto inicial posiblemente desactualizado.
        </div>
      )}

      <CashProjectionChart projection={proj} />

      <ProjectionTimeline
        events={proj.events}
        horizonDays={proj.horizonDays}
      />

      <CashCategoryBreakdown
        categoryTotals={proj.categoryTotals}
        horizonDays={proj.horizonDays}
      />

      <CustomerInflowBreakdownTable
        rows={proj.customerInflowBreakdown}
        horizonDays={proj.horizonDays}
      />

      <SensitivityAnalysisBlock projection={proj} />

      <ModelLearningBadge learning={proj.learning} />

      {belowFloor && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
          Saldo mínimo proyectado <Currency amount={proj.minBalance} /> el{" "}
          {proj.minBalanceDate} cruza el piso configurable de{" "}
          <Currency amount={proj.safetyFloor} />.
        </div>
      )}

      {proj.overdueInflowCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className="border-warning/40 text-warning text-[10px]"
          >
            <AlertTriangle className="mr-1 size-3" aria-hidden />
            {proj.overdueInflowCount} entradas ya vencidas
          </Badge>
          <span>
            Entradas esperadas (ponderadas):{" "}
            <Currency amount={proj.totalInflow} /> de{" "}
            <Currency amount={proj.totalInflowNominal} /> nominales.
          </span>
        </div>
      )}
    </QuestionSection>
  );
}

/* Desglose de inflows/outflows del cash projection por categoría ───── */
function CashCategoryBreakdown({
  categoryTotals,
  horizonDays,
}: {
  categoryTotals: CashFlowCategoryTotal[];
  horizonDays: number;
}) {
  if (categoryTotals.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const inflows = categoryTotals.filter((c) => c.flowType === "inflow");
  const outflows = categoryTotals.filter((c) => c.flowType === "outflow");
  const totalIn = inflows.reduce((s, c) => s + c.amountMxn, 0);
  const totalOut = outflows.reduce((s, c) => s + c.amountMxn, 0);
  const net = totalIn - totalOut;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* Entradas */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Entradas esperadas · {horizonDays}d
        </div>
        <div className="divide-y">
          {inflows.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin entradas
            </div>
          ) : (
            inflows.map((c) => {
              const pct = totalIn > 0 ? (c.amountMxn / totalIn) * 100 : 0;
              return (
                <div
                  key={c.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{c.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-success/60"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums text-success">
                      +{fmt(c.amountMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-success/30 bg-success/10 px-3 py-2 text-sm font-semibold sm:px-4">
            <span>Total entradas</span>
            <span className="tabular-nums text-success">+{fmt(totalIn)}</span>
          </div>
        </div>
      </div>

      {/* Salidas */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Salidas programadas · {horizonDays}d
        </div>
        <div className="divide-y">
          {outflows.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin salidas
            </div>
          ) : (
            outflows.map((c) => {
              const pct = totalOut > 0 ? (c.amountMxn / totalOut) * 100 : 0;
              return (
                <div
                  key={c.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{c.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-destructive/60"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums text-destructive">
                      −{fmt(c.amountMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold sm:px-4">
            <span>Total salidas</span>
            <span className="tabular-nums text-destructive">
              −{fmt(totalOut)}
            </span>
          </div>
        </div>
      </div>

      {/* Net del período */}
      <div
        className={cn(
          "rounded-md border px-3 py-2 text-sm md:col-span-2 sm:px-4",
          net >= 0
            ? "border-success/40 bg-success/10"
            : "border-destructive/40 bg-destructive/10"
        )}
      >
        <div className="flex items-center justify-between gap-3 font-semibold">
          <span>Cambio neto en cash · {horizonDays}d</span>
          <span
            className={cn(
              "tabular-nums",
              net >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {net >= 0 ? "+" : ""}
            {fmt(net)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Incluye AR/AP factura por factura + gastos recurrentes
          proyectados desde patrón histórico (nómina día 15 + último,
          renta día 1, servicios día 10, arrendamiento día 5) + cobranza
          proyectada de ventas futuras (ponderada al 85%).
        </p>
      </div>
    </div>
  );
}


function SummaryStat({
  label,
  value,
  positive,
  negative,
  highlight,
  stale,
  staleHours,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  highlight?: boolean;
  stale?: boolean;
  staleHours?: number;
}) {
  const color = stale
    ? "text-warning"
    : positive
      ? "text-success"
      : negative
        ? "text-danger"
        : highlight
          ? "text-warning"
          : "text-foreground";
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        {stale && (
          <Badge
            variant="outline"
            className="border-warning/40 px-1 py-0 text-[9px] leading-tight text-warning"
            title={`Saldo bancario stale: hace ${staleHours}h`}
          >
            stale {staleHours}h
          </Badge>
        )}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>
        {formatCurrencyMXN(value, { compact: true })}
      </div>
    </div>
  );
}
