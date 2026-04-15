import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  ProjectedCashFlowTopAr,
  ProjectedCashFlowWeek,
} from "@/lib/queries/finance";

interface Props {
  weeks: ProjectedCashFlowWeek[];
  topArByWeek: ProjectedCashFlowTopAr[];
}

const monthShort = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function fmtWeek(w: ProjectedCashFlowWeek) {
  // YYYY-MM-DD → "Sem N · 15 abr"
  const [y, m, d] = w.weekStart.split("-").map((x) => Number(x));
  if (!y || !m || !d) return `Sem ${w.weekIndex + 1}`;
  return `Sem ${w.weekIndex + 1} · ${d} ${monthShort[m - 1] ?? m}`;
}

function cell(
  value: number,
  opts?: { muted?: boolean; signed?: boolean }
) {
  if (value === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls = opts?.signed
    ? value > 0
      ? "text-success tabular-nums"
      : "text-danger tabular-nums"
    : opts?.muted
      ? "text-muted-foreground tabular-nums"
      : "tabular-nums";
  return <span className={cls}>{formatCurrencyMXN(value, { compact: true })}</span>;
}

function balanceCell(value: number) {
  const cls =
    value < 0
      ? "text-danger font-semibold tabular-nums"
      : value < 100000
        ? "text-warning font-semibold tabular-nums"
        : "text-success font-semibold tabular-nums";
  return <span className={cls}>{formatCurrencyMXN(value, { compact: true })}</span>;
}

export function ProjectedCashFlowTable({ weeks, topArByWeek }: Props) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay datos de proyección.
      </p>
    );
  }

  const totals = weeks.reduce(
    (acc, w) => {
      acc.arCommitted += w.arCommitted;
      acc.arOverdue += w.arOverdue;
      acc.soPipeline += w.soPipeline;
      acc.apCommitted += w.apCommitted;
      acc.apOverdue += w.apOverdue;
      acc.poPipeline += w.poPipeline;
      acc.payroll += w.payrollEstimated;
      acc.opex += w.opexRecurring;
      acc.inflows += w.inflowsTotal;
      acc.outflows += w.outflowsTotal;
      acc.net += w.netFlow;
      return acc;
    },
    {
      arCommitted: 0,
      arOverdue: 0,
      soPipeline: 0,
      apCommitted: 0,
      apOverdue: 0,
      poPipeline: 0,
      payroll: 0,
      opex: 0,
      inflows: 0,
      outflows: 0,
      net: 0,
    }
  );

  // Group top AR by week for drill-down
  const topArGrouped = new Map<number, ProjectedCashFlowTopAr[]>();
  for (const r of topArByWeek) {
    const arr = topArGrouped.get(r.weekIndex) ?? [];
    arr.push(r);
    topArGrouped.set(r.weekIndex, arr);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 font-medium">
                Semana
              </th>
              <th className="px-2 py-2 text-right font-medium">CxC venc.</th>
              <th className="px-2 py-2 text-right font-medium">CxC prog.</th>
              <th className="px-2 py-2 text-right font-medium">Pipeline SO</th>
              <th className="px-2 py-2 text-right font-medium">Entradas</th>
              <th className="px-2 py-2 text-right font-medium">CxP venc.</th>
              <th className="px-2 py-2 text-right font-medium">CxP prog.</th>
              <th className="px-2 py-2 text-right font-medium">PO prog.</th>
              <th className="px-2 py-2 text-right font-medium">Nómina</th>
              <th className="px-2 py-2 text-right font-medium">OpEx</th>
              <th className="px-2 py-2 text-right font-medium">Salidas</th>
              <th className="px-2 py-2 text-right font-medium">Neto</th>
              <th className="px-2 py-2 text-right font-medium">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekIndex} className="border-b last:border-0">
                <td className="sticky left-0 z-10 bg-card px-2 py-2 font-medium whitespace-nowrap">
                  {fmtWeek(w)}
                </td>
                <td className="px-2 py-2 text-right">{cell(w.arOverdue)}</td>
                <td className="px-2 py-2 text-right">{cell(w.arCommitted)}</td>
                <td className="px-2 py-2 text-right">
                  {cell(w.soPipeline, { muted: true })}
                </td>
                <td className="px-2 py-2 text-right font-medium text-success">
                  {cell(w.inflowsTotal)}
                </td>
                <td className="px-2 py-2 text-right">{cell(w.apOverdue)}</td>
                <td className="px-2 py-2 text-right">{cell(w.apCommitted)}</td>
                <td className="px-2 py-2 text-right">
                  {cell(w.poPipeline, { muted: true })}
                </td>
                <td className="px-2 py-2 text-right">
                  {cell(w.payrollEstimated)}
                </td>
                <td className="px-2 py-2 text-right">{cell(w.opexRecurring)}</td>
                <td className="px-2 py-2 text-right font-medium text-danger">
                  {cell(w.outflowsTotal)}
                </td>
                <td className="px-2 py-2 text-right">
                  {cell(w.netFlow, { signed: true })}
                </td>
                <td className="px-2 py-2 text-right">
                  {balanceCell(w.closingBalance)}
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/40 font-semibold">
              <td className="sticky left-0 z-10 bg-muted/40 px-2 py-2">
                Totales 13s
              </td>
              <td className="px-2 py-2 text-right">{cell(totals.arOverdue)}</td>
              <td className="px-2 py-2 text-right">
                {cell(totals.arCommitted)}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(totals.soPipeline, { muted: true })}
              </td>
              <td className="px-2 py-2 text-right text-success">
                {cell(totals.inflows)}
              </td>
              <td className="px-2 py-2 text-right">{cell(totals.apOverdue)}</td>
              <td className="px-2 py-2 text-right">
                {cell(totals.apCommitted)}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(totals.poPipeline, { muted: true })}
              </td>
              <td className="px-2 py-2 text-right">{cell(totals.payroll)}</td>
              <td className="px-2 py-2 text-right">{cell(totals.opex)}</td>
              <td className="px-2 py-2 text-right text-danger">
                {cell(totals.outflows)}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(totals.net, { signed: true })}
              </td>
              <td className="px-2 py-2 text-right">
                {balanceCell(weeks[weeks.length - 1]?.closingBalance ?? 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {topArByWeek.length > 0 && (
        <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Top clientes por semana (drill-down CxC)
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {weeks
              .filter((w) => (topArGrouped.get(w.weekIndex) ?? []).length > 0)
              .map((w) => {
                const rows = topArGrouped.get(w.weekIndex) ?? [];
                return (
                  <div
                    key={w.weekIndex}
                    className="rounded-md border border-border/60 bg-card px-3 py-2"
                  >
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {fmtWeek(w)}
                    </div>
                    <ul className="space-y-1">
                      {rows.map((r) => (
                        <li
                          key={`${r.weekIndex}-${r.rank}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {r.companyName ?? "—"}{" "}
                            <span className="text-muted-foreground">
                              ({r.invoicesCount})
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {formatCurrencyMXN(r.totalAmount, {
                              compact: true,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground">
        CxC/CxP venc. = facturas vencidas no pagadas (cargadas en semana 1).
        CxC prog. = facturas con vencimiento ajustado por atraso histórico
        (payment_predictions.avg_days_to_pay). Pipeline SO/PO = órdenes
        confirmadas (informativo, no suma al saldo). Nómina = CFDI tipo N
        (promedio 90d), pagada el 15 y último día del mes. OpEx = promedio 3m
        de gastos operativos sin COGS ni nómina, distribuido semanalmente.
      </p>
    </div>
  );
}
