import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatCurrencyMXN } from "@/lib/formatters";
import type { ProjectedCashFlowWeek } from "@/lib/queries/analytics/finance";

interface Props {
  weeks: ProjectedCashFlowWeek[];
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

function formatAmount(value: number): string {
  if (value === 0) return "—";
  return formatCurrencyMXN(value, { compact: true });
}

function amountClass(
  value: number,
  opts?: { signed?: boolean; muted?: boolean },
): string {
  if (value === 0) return "text-muted-foreground";
  if (opts?.muted) return "text-muted-foreground tabular-nums";
  if (opts?.signed) {
    return value > 0 ? "text-success tabular-nums" : "text-danger tabular-nums";
  }
  return "tabular-nums";
}

function balanceClass(value: number): string {
  if (value < 0) return "text-danger font-semibold tabular-nums";
  if (value < 100000) return "text-warning font-semibold tabular-nums";
  return "text-success font-semibold tabular-nums";
}

interface AmountCellProps {
  gross: number;
  weighted: number;
  overdueGross?: number;
  muted?: boolean;
}

function AmountCell({
  gross,
  weighted,
  overdueGross,
  muted = false,
}: AmountCellProps) {
  if (weighted === 0 && gross === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={amountClass(weighted, { muted })}>
          {formatAmount(weighted)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <p>
            Gross:{" "}
            <span className="font-semibold">{formatCurrencyMXN(gross)}</span>
          </p>
          {overdueGross != null && overdueGross > 0 && (
            <p>
              Vencido:{" "}
              <span className="font-semibold">
                {formatCurrencyMXN(overdueGross)}
              </span>
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectedCashFlowTable({ weeks }: Props) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No hay datos de proyección.</p>
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
    <TooltipProvider delayDuration={150}>
      <Table className="min-w-[1100px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Semana</TableHead>
            <TableHead className="text-right">CxC cobro</TableHead>
            <TableHead className="text-right">SO backlog</TableHead>
            <TableHead className="text-right">Entradas</TableHead>
            <TableHead className="text-right">CxP pago</TableHead>
            <TableHead className="text-right">PO backlog</TableHead>
            <TableHead className="text-right">Nómina</TableHead>
            <TableHead className="text-right">OpEx</TableHead>
            <TableHead className="text-right">IVA</TableHead>
            <TableHead className="text-right">Salidas</TableHead>
            <TableHead className="text-right">Neto</TableHead>
            <TableHead className="text-right">Saldo final</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeks.map((w) => (
            <TableRow key={w.weekIndex}>
              <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-medium">
                {fmtWeek(w)}
              </TableCell>
              <TableCell className="text-right">
                <AmountCell
                  gross={w.arGross}
                  weighted={w.arWeighted}
                  overdueGross={w.arOverdueGross}
                />
              </TableCell>
              <TableCell className="text-right">
                <AmountCell gross={w.soGross} weighted={w.soWeighted} muted />
              </TableCell>
              <TableCell className="text-right font-medium text-success tabular-nums">
                {formatAmount(w.inflowsWeighted)}
              </TableCell>
              <TableCell className="text-right">
                <AmountCell
                  gross={w.apGross}
                  weighted={w.apWeighted}
                  overdueGross={w.apOverdueGross}
                />
              </TableCell>
              <TableCell className="text-right">
                <AmountCell gross={w.poGross} weighted={w.poWeighted} muted />
              </TableCell>
              <TableCell className={cn("text-right", amountClass(w.payrollEstimated))}>
                {formatAmount(w.payrollEstimated)}
              </TableCell>
              <TableCell className={cn("text-right", amountClass(w.opexRecurring))}>
                {formatAmount(w.opexRecurring)}
              </TableCell>
              <TableCell className={cn("text-right", amountClass(w.taxEstimated))}>
                {formatAmount(w.taxEstimated)}
              </TableCell>
              <TableCell className="text-right font-medium text-danger tabular-nums">
                {formatAmount(w.outflowsWeighted)}
              </TableCell>
              <TableCell
                className={cn("text-right", amountClass(w.netFlow, { signed: true }))}
              >
                {formatAmount(w.netFlow)}
              </TableCell>
              <TableCell className={cn("text-right", balanceClass(w.closingBalance))}>
                {formatCurrencyMXN(w.closingBalance, { compact: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-muted font-semibold">
              Totales 13s
            </TableCell>
            <TableCell
              className={cn("text-right font-semibold", amountClass(totals.arWeighted))}
            >
              {formatAmount(totals.arWeighted)}
            </TableCell>
            <TableCell className="text-right font-semibold text-muted-foreground tabular-nums">
              {formatAmount(totals.soWeighted)}
            </TableCell>
            <TableCell className="text-right font-semibold text-success tabular-nums">
              {formatAmount(totals.inflowsWeighted)}
            </TableCell>
            <TableCell
              className={cn("text-right font-semibold", amountClass(totals.apWeighted))}
            >
              {formatAmount(totals.apWeighted)}
            </TableCell>
            <TableCell className="text-right font-semibold text-muted-foreground tabular-nums">
              {formatAmount(totals.poWeighted)}
            </TableCell>
            <TableCell
              className={cn("text-right font-semibold", amountClass(totals.payroll))}
            >
              {formatAmount(totals.payroll)}
            </TableCell>
            <TableCell
              className={cn("text-right font-semibold", amountClass(totals.opex))}
            >
              {formatAmount(totals.opex)}
            </TableCell>
            <TableCell
              className={cn("text-right font-semibold", amountClass(totals.tax))}
            >
              {formatAmount(totals.tax)}
            </TableCell>
            <TableCell className="text-right font-semibold text-danger tabular-nums">
              {formatAmount(totals.outflowsWeighted)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-semibold",
                amountClass(totals.net, { signed: true }),
              )}
            >
              {formatAmount(totals.net)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right",
                balanceClass(weeks[weeks.length - 1]?.closingBalance ?? 0),
              )}
            >
              {formatCurrencyMXN(
                weeks[weeks.length - 1]?.closingBalance ?? 0,
                { compact: true },
              )}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Montos ponderados por confidence (hover para ver gross). CxC cobro =
        facturas cliente × probabilidad de pago según behavior real. SO/PO
        backlog = órdenes confirmadas no facturadas. IVA = promedio 3m del IVA
        neto. Nómina = avg 3m cuentas sueldo/salario, pagada quincenal.
      </p>
    </TooltipProvider>
  );
}
