import { formatCurrencyMXN } from "@/lib/formatters";
import type { CrossAccountMovementsSummary } from "@/lib/queries/sp13/finanzas/cross-account-movements";

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

export function MovementsHeader({
  summary,
}: {
  summary: CrossAccountMovementsSummary;
}) {
  return (
    <header className="border-b pb-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Análisis cross-account · {periodLabel(summary.period)}
      </p>
      <h1 className="text-2xl font-bold mt-1">
        ¿Qué se movió fuera de lo normal este mes?
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
        Todas las cuentas P&amp;L con cambio material vs promedio últimos 3
        meses cerrados (umbral $50k). Click cualquier fila para ver el
        detalle de proveedores en esa cuenta.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-5 max-w-2xl">
        <Kpi
          label="Cuentas con movimiento"
          value={String(summary.movements.length)}
        />
        <Kpi
          label="Anomalías detectadas"
          value={String(summary.anomalyCount)}
          tone={summary.anomalyCount > 5 ? "warning" : undefined}
        />
        <Kpi
          label="Cambio absoluto total"
          value={formatCurrencyMXN(summary.totalAbsChange, { compact: true })}
          sub="vs run rate 3m"
        />
      </div>
    </header>
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
  tone?: "warning";
}) {
  const valueColor = tone === "warning" ? "text-amber-700" : "";
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub ? (
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      ) : null}
    </div>
  );
}
