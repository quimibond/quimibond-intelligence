import { formatCurrencyMXN } from "@/lib/formatters";
import type { MonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";

export function ReportHeader({ report }: { report: MonthlyReport }) {
  const { pnl } = report;
  const utilLimpia = pnl.curr.utilidadLimpia;
  const utilNorm = report.utilidadNormalizada;
  const dUtil = pnl.curr.utilidadLimpia - pnl.prev.utilidadLimpia;

  const status = utilNorm >= 0 ? "positivo" : "negativo";
  const statusColor =
    utilNorm >= 0 ? "text-emerald-700" : "text-red-700";

  return (
    <header className="border-b pb-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Quimibond · Reporte mensual de cierre
          </p>
          <h1 className="text-3xl font-bold mt-1">{report.periodLabel}</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Generado</p>
          <p className="text-sm">
            {new Date(report.generatedAt).toLocaleString("es-MX", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <Stat
          label="Ventas (4xx)"
          value={formatCurrencyMXN(pnl.curr.ventas4xx, { compact: true })}
          delta={pnl.curr.ventas4xx - pnl.prev.ventas4xx}
        />
        <Stat
          label="EBIT limpio"
          value={formatCurrencyMXN(pnl.curr.ebitLimpio, { compact: true })}
          delta={pnl.curr.ebitLimpio - pnl.prev.ebitLimpio}
        />
        <Stat
          label="Utilidad neta limpia"
          value={formatCurrencyMXN(utilLimpia, { compact: true })}
          delta={dUtil}
          accent={statusColor}
        />
        <Stat
          label="Util. normalizada"
          value={formatCurrencyMXN(utilNorm, { compact: true })}
          subtitle={`(quita one-offs · ${status})`}
          accent={statusColor}
        />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  delta,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  delta?: number;
  subtitle?: string;
  accent?: string;
}) {
  const deltaSign = delta == null ? "" : delta >= 0 ? "+" : "";
  const deltaColor =
    delta == null
      ? "text-muted-foreground"
      : delta >= 0
        ? "text-emerald-700"
        : "text-red-700";
  return (
    <div className="rounded border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${accent ?? ""}`}>{value}</p>
      {delta != null ? (
        <p className={`text-xs ${deltaColor}`}>
          {deltaSign}
          {formatCurrencyMXN(delta, { compact: true })} vs mes anterior
        </p>
      ) : null}
      {subtitle ? (
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      ) : null}
    </div>
  );
}
