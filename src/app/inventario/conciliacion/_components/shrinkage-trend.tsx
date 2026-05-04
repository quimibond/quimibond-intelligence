import { formatCurrencyMXN } from "@/lib/formatters";
import type { ShrinkageSummary } from "@/lib/queries/sp13/finanzas/shrinkage-tracker";

const SPANISH_MONTHS_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function shortMonth(period: string): string {
  const [y, m] = period.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS_SHORT[m - 1]} '${String(y).slice(2)}`;
}

export function ShrinkageTrend({ summary }: { summary: ShrinkageSummary }) {
  const maxLoss = Math.max(...summary.byMonth.map((m) => m.totalLossMxn), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Pérdida total YTD"
          value={formatCurrencyMXN(summary.totalLossMxn, { compact: true })}
          tone="loss"
        />
        <Kpi
          label="Eventos"
          value={String(summary.totalEvents)}
          sub="ajustes de conteo registrados"
        />
        <Kpi
          label="SKUs únicos"
          value={String(summary.uniqueSkus)}
          sub="productos diferentes con shrinkage"
        />
        <Kpi
          label="Promedio por evento"
          value={formatCurrencyMXN(
            summary.totalEvents > 0
              ? summary.totalLossMxn / summary.totalEvents
              : 0,
            { compact: true }
          )}
        />
      </div>

      <div className="rounded border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">
          Tendencia mensual — barra proporcional a la pérdida del mes
        </p>
        <ul className="space-y-2">
          {summary.byMonth.map((m) => {
            const pct = (m.totalLossMxn / maxLoss) * 100;
            const isAtypical = m.totalLossMxn > 200_000;
            return (
              <li key={m.period} className="flex items-baseline gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {shortMonth(m.period)}
                </span>
                <div className="flex-1 h-5 bg-muted/30 rounded relative overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      isAtypical ? "bg-red-500/70" : "bg-amber-400/70"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tabular-nums text-sm w-32 text-right shrink-0">
                  {formatCurrencyMXN(m.totalLossMxn, { compact: true })}
                </span>
                <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
                  {m.events} eventos · {m.uniqueSkus} SKUs
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "loss";
}) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          tone === "loss" ? "text-red-700" : ""
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      ) : null}
    </div>
  );
}
