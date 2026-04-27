import Link from "next/link";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomerCashflowRow } from "@/lib/queries/sp13/finanzas";

/**
 * Top 10 clientes con desglose de inflow esperado por capa.
 * Visualización tricolor apilada (AR + SO + Run rate residual).
 */
export function CustomerInflowBreakdownTable({
  rows,
  horizonDays,
}: {
  rows: CustomerCashflowRow[];
  horizonDays: number;
}) {
  if (rows.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const top = rows.slice(0, 10);

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="border-b bg-muted/30 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top 10 clientes · cobranza esperada · {horizonDays}d
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-success/70" />
              AR (capa 1)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-info/70" />
              SO (capa 2)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-warning/70" />
              Run rate (capa 3)
            </span>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Saturación = (AR + SO) / run rate × 100. ≥100% = pipeline cubre
          (capa 3 = $0). &lt;100% = gap → capa 3 aporta el residual.
          Cada barra suma al run rate mensual del cliente — los segmentos
          son los 3 buckets weighted, sin duplicar.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Cliente</TableHead>
              <TableHead className="text-right">Run rate/mes</TableHead>
              <TableHead className="min-w-[280px]">Mezcla esperada</TableHead>
              <TableHead className="text-right">Total esperado</TableHead>
              <TableHead className="text-right">Saturación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((r) => {
              const satTone =
                r.saturationPct == null
                  ? "text-muted-foreground"
                  : r.saturationPct >= 100
                    ? "text-success"
                    : r.saturationPct >= 60
                      ? "text-warning"
                      : "text-destructive";
              const denom = Math.max(
                r.expectedInHorizonMxn,
                r.bucket1WeightedMxn + r.bucket2WeightedMxn + r.bucket3ExpectedMxn
              );
              const arPct = denom > 0 ? (r.bucket1WeightedMxn / denom) * 100 : 0;
              const soPct = denom > 0 ? (r.bucket2WeightedMxn / denom) * 100 : 0;
              const rrPct = denom > 0 ? (r.bucket3ExpectedMxn / denom) * 100 : 0;
              return (
                <TableRow key={r.customerId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/empresas/${r.customerId}`}
                      className="hover:underline"
                    >
                      {r.customerName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(r.monthlyAvgMxn)}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
                      aria-label={`AR ${fmt(r.bucket1WeightedMxn)}, SO ${fmt(r.bucket2WeightedMxn)}, run rate ${fmt(r.bucket3ExpectedMxn)}`}
                    >
                      <div
                        className="h-full bg-success/70"
                        style={{ width: `${arPct}%` }}
                        title={`AR ya facturado: ${fmt(r.bucket1WeightedMxn)}`}
                      />
                      <div
                        className="h-full bg-info/70"
                        style={{ width: `${soPct}%` }}
                        title={`SO sin factura: ${fmt(r.bucket2WeightedMxn)}`}
                      />
                      <div
                        className="h-full bg-warning/70"
                        style={{ width: `${rrPct}%` }}
                        title={`Run rate residual: ${fmt(r.bucket3ExpectedMxn)}`}
                      />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                      <span title="AR (capa 1)">{fmt(r.bucket1WeightedMxn)}</span>
                      <span title="SO (capa 2)">
                        {r.bucket2WeightedMxn > 0
                          ? fmt(r.bucket2WeightedMxn)
                          : "—"}
                      </span>
                      <span title="Run rate residual (capa 3)">
                        {r.bucket3ExpectedMxn > 0
                          ? fmt(r.bucket3ExpectedMxn)
                          : "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmt(r.totalExpectedMxn)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${satTone}`}>
                    {r.saturationPct == null
                      ? "—"
                      : `${r.saturationPct.toFixed(0)}%`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
