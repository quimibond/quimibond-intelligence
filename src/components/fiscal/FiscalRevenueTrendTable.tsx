import { getFiscalRevenueMonthly } from "@/lib/queries/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatMonth(month: string): string {
  const labels = [
    "ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic",
  ];
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return `${labels[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

/**
 * Revenue fiscal trend table — last N months ordered newest-first.
 * Pure server component.
 */
export async function FiscalRevenueTrendTable({ months = 24 }: { months?: number }) {
  const rows = await getFiscalRevenueMonthly(months);

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Sin datos en syntage_revenue_fiscal_monthly.
      </p>
    );
  }

  // Max revenue for bar width calculation
  const maxRevenue = Math.max(...rows.map((r) => r.revenue_mxn ?? 0), 1);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right">Revenue (SAT)</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Gasto</TableHead>
            <TableHead className="hidden text-right md:table-cell">CFDIs emit.</TableHead>
            <TableHead className="hidden text-right md:table-cell">Clientes</TableHead>
            <TableHead>Tendencia</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const barPct = maxRevenue > 0 ? (r.revenue_mxn / maxRevenue) * 100 : 0;
            return (
              <TableRow key={r.month}>
                <TableCell className="font-mono text-xs">{formatMonth(r.month)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrencyMXN(r.revenue_mxn, { compact: true })}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                  {formatCurrencyMXN(r.gasto_mxn, { compact: true })}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {r.cfdis_emitidos?.toLocaleString("es-MX") ?? "—"}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {r.clientes_unicos?.toLocaleString("es-MX") ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <div
                      className="h-3 rounded-sm bg-primary/60"
                      style={{ width: `${Math.max(barPct, 2)}%`, maxWidth: "120px", minWidth: "2px" }}
                      title={`${barPct.toFixed(0)}%`}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
