import { getFiscalRevenueMonthly } from "@/lib/queries/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";

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
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Mes</th>
            <th className="px-3 py-2 text-right">Revenue (SAT)</th>
            <th className="hidden px-3 py-2 text-right sm:table-cell">Gasto</th>
            <th className="hidden px-3 py-2 text-right md:table-cell">CFDIs emit.</th>
            <th className="hidden px-3 py-2 text-right md:table-cell">Clientes</th>
            <th className="px-3 py-2 text-left">Tendencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const barPct = maxRevenue > 0 ? (r.revenue_mxn / maxRevenue) * 100 : 0;
            return (
              <tr key={r.month} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">{formatMonth(r.month)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(r.revenue_mxn, { compact: true })}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                  {formatCurrencyMXN(r.gasto_mxn, { compact: true })}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {r.cfdis_emitidos?.toLocaleString("es-MX") ?? "—"}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {r.clientes_unicos?.toLocaleString("es-MX") ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <div
                      className="h-3 rounded-sm bg-primary/60"
                      style={{ width: `${Math.max(barPct, 2)}%`, maxWidth: "120px", minWidth: "2px" }}
                      title={`${barPct.toFixed(0)}%`}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
