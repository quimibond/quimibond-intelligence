import { formatCurrencyMXN } from "@/lib/formatters";
import type { ProjectedCashFlowWeek } from "@/lib/queries/finance";

interface Props {
  weeks: ProjectedCashFlowWeek[];
  /** Si true, muestra columnas gross adicionales en tooltip. */
  showGross?: boolean;
}

const monthShort = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function fmtWeek(w: ProjectedCashFlowWeek) {
  const [y, m, d] = w.weekStart.split("-").map((x) => Number(x));
  if (!y || !m || !d) return `Sem ${w.weekIndex + 1}`;
  return `Sem ${w.weekIndex + 1} · ${d} ${monthShort[m - 1] ?? m}`;
}

function cell(
  value: number,
  opts?: { muted?: boolean; signed?: boolean; title?: string },
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
  return (
    <span className={cls} title={opts?.title}>
      {formatCurrencyMXN(value, { compact: true })}
    </span>
  );
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

export function ProjectedCashFlowTable({ weeks }: Props) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay datos de proyeccion.
      </p>
    );
  }

  const totals = weeks.reduce(
    (acc, w) => {
      acc.arWeighted += w.arWeighted;
      acc.arGross += w.arGross;
      acc.soWeighted += w.soWeighted;
      acc.soGross += w.soGross;
      acc.apWeighted += w.apWeighted;
      acc.apGross += w.apGross;
      acc.poWeighted += w.poWeighted;
      acc.poGross += w.poGross;
      acc.payroll += w.payrollEstimated;
      acc.opex += w.opexRecurring;
      acc.tax += w.taxEstimated;
      acc.inflowsWeighted += w.inflowsWeighted;
      acc.outflowsWeighted += w.outflowsWeighted;
      acc.net += w.netFlow;
      return acc;
    },
    {
      arWeighted: 0,
      arGross: 0,
      soWeighted: 0,
      soGross: 0,
      apWeighted: 0,
      apGross: 0,
      poWeighted: 0,
      poGross: 0,
      payroll: 0,
      opex: 0,
      tax: 0,
      inflowsWeighted: 0,
      outflowsWeighted: 0,
      net: 0,
    },
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1200px] text-xs">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card px-2 py-2 font-medium">Semana</th>
            <th className="px-2 py-2 text-right font-medium">CxC cobro</th>
            <th className="px-2 py-2 text-right font-medium">SO backlog</th>
            <th className="px-2 py-2 text-right font-medium">Entradas</th>
            <th className="px-2 py-2 text-right font-medium">CxP pago</th>
            <th className="px-2 py-2 text-right font-medium">PO backlog</th>
            <th className="px-2 py-2 text-right font-medium">Nómina</th>
            <th className="px-2 py-2 text-right font-medium">OpEx</th>
            <th className="px-2 py-2 text-right font-medium">IVA</th>
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
              <td className="px-2 py-2 text-right">
                {cell(w.arWeighted, {
                  title: `Gross: ${formatCurrencyMXN(w.arGross)}${
                    w.arOverdueGross > 0
                      ? ` · Vencido: ${formatCurrencyMXN(w.arOverdueGross)}`
                      : ""
                  }`,
                })}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(w.soWeighted, {
                  muted: true,
                  title: `Gross: ${formatCurrencyMXN(w.soGross)}`,
                })}
              </td>
              <td className="px-2 py-2 text-right font-medium text-success">
                {cell(w.inflowsWeighted)}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(w.apWeighted, {
                  title: `Gross: ${formatCurrencyMXN(w.apGross)}${
                    w.apOverdueGross > 0
                      ? ` · Vencido: ${formatCurrencyMXN(w.apOverdueGross)}`
                      : ""
                  }`,
                })}
              </td>
              <td className="px-2 py-2 text-right">
                {cell(w.poWeighted, {
                  muted: true,
                  title: `Gross: ${formatCurrencyMXN(w.poGross)}`,
                })}
              </td>
              <td className="px-2 py-2 text-right">{cell(w.payrollEstimated)}</td>
              <td className="px-2 py-2 text-right">{cell(w.opexRecurring)}</td>
              <td className="px-2 py-2 text-right">{cell(w.taxEstimated)}</td>
              <td className="px-2 py-2 text-right font-medium text-danger">
                {cell(w.outflowsWeighted)}
              </td>
              <td className="px-2 py-2 text-right">{cell(w.netFlow, { signed: true })}</td>
              <td className="px-2 py-2 text-right">{balanceCell(w.closingBalance)}</td>
            </tr>
          ))}
          <tr className="border-t bg-muted/40 font-semibold">
            <td className="sticky left-0 z-10 bg-muted/40 px-2 py-2">Totales 13s</td>
            <td className="px-2 py-2 text-right">{cell(totals.arWeighted)}</td>
            <td className="px-2 py-2 text-right">{cell(totals.soWeighted, { muted: true })}</td>
            <td className="px-2 py-2 text-right text-success">
              {cell(totals.inflowsWeighted)}
            </td>
            <td className="px-2 py-2 text-right">{cell(totals.apWeighted)}</td>
            <td className="px-2 py-2 text-right">{cell(totals.poWeighted, { muted: true })}</td>
            <td className="px-2 py-2 text-right">{cell(totals.payroll)}</td>
            <td className="px-2 py-2 text-right">{cell(totals.opex)}</td>
            <td className="px-2 py-2 text-right">{cell(totals.tax)}</td>
            <td className="px-2 py-2 text-right text-danger">
              {cell(totals.outflowsWeighted)}
            </td>
            <td className="px-2 py-2 text-right">{cell(totals.net, { signed: true })}</td>
            <td className="px-2 py-2 text-right">
              {balanceCell(weeks[weeks.length - 1]?.closingBalance ?? 0)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Montos ponderados por <strong>confidence</strong> (gross en tooltip). CxC cobro =
        facturas cliente × probabilidad de pago según behavior real del cliente (vencidas
        cargadas en semana 1, ajustadas por pagos ya conciliados). SO backlog = órdenes
        confirmadas no facturadas, fecha de cobro estimada por cliente. IVA = promedio 3m
        del IVA neto (solo cuando es positivo). Nómina estimada = promedio 3m cuentas
        sueldo/salario/IMSS/infonavit, quincenal. OpEx = promedio 3m sin COGS ni nómina.
      </p>
    </div>
  );
}
