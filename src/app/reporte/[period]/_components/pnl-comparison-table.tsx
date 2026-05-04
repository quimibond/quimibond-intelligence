import { formatCurrencyMXN } from "@/lib/formatters";
import type { MonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";

export function PnlComparisonTable({ report }: { report: MonthlyReport }) {
  const c = report.pnl.curr;
  const p = report.pnl.prev;

  const rows: Array<{
    label: string;
    curr: number;
    prev: number;
    isTotal?: boolean;
    isSubtotal?: boolean;
    isNegative?: boolean;
  }> = [
    { label: "Ventas de producto (4xx)", curr: c.ventas4xx, prev: p.ventas4xx },
    {
      label: "− Costo MP recursivo (BOM)",
      curr: -c.cogsRecursivoMp,
      prev: -p.cogsRecursivoMp,
    },
    {
      label: "− Mano de obra directa (501.06)",
      curr: -c.mod501_06,
      prev: -p.mod501_06,
    },
    {
      label: "− Compras importación (502)",
      curr: -c.compras502,
      prev: -p.compras502,
    },
    {
      label: "− Overhead fábrica (504.01)",
      curr: -c.overhead504_01,
      prev: -p.overhead504_01,
    },
    ...(c.cogs501_01_02 !== 0 || p.cogs501_01_02 !== 0
      ? [
          {
            label: "− 501.01.02 COSTO PRIMO contable",
            curr: -c.cogs501_01_02,
            prev: -p.cogs501_01_02,
          },
        ]
      : []),
    ...(c.shrinkage !== 0 || p.shrinkage !== 0
      ? [
          {
            label: "− 501.01.08 Pérdida por inventario (shrinkage)",
            curr: -c.shrinkage,
            prev: -p.shrinkage,
          },
        ]
      : []),
    {
      label: "= Ganancia bruta limpia",
      curr: c.ventas4xx - c.costoVentasLimpio,
      prev: p.ventas4xx - p.costoVentasLimpio,
      isSubtotal: true,
    },
    {
      label: "− Gasto de operación (6xx)",
      curr: -c.gastosOp6xx,
      prev: -p.gastosOp6xx,
    },
    {
      label: "= EBIT limpio",
      curr: c.ebitLimpio,
      prev: p.ebitLimpio,
      isSubtotal: true,
    },
    {
      label: "+ Otros ingresos netos (7xx)",
      curr: c.otros7xx,
      prev: p.otros7xx,
    },
    {
      label: "− Depreciación (504.08-23 + 613)",
      curr: -c.depreciacion,
      prev: -p.depreciacion,
    },
    {
      label: "= UTILIDAD NETA limpia",
      curr: c.utilidadLimpia,
      prev: p.utilidadLimpia,
      isTotal: true,
    },
  ];

  const dResidual = c.capaResidual;

  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Concepto</th>
            <th className="text-right px-3 py-2 font-medium w-32">
              {report.periodLabel}
            </th>
            <th className="text-right px-3 py-2 font-medium w-32 text-muted-foreground">
              {report.periodPrevLabel}
            </th>
            <th className="text-right px-3 py-2 font-medium w-32">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const delta = r.curr - r.prev;
            const deltaColor = delta >= 0 ? "text-emerald-700" : "text-red-700";
            const baseClass = r.isTotal
              ? "font-bold border-t-2 bg-muted/30"
              : r.isSubtotal
                ? "font-semibold border-t bg-muted/10"
                : "";
            return (
              <tr key={i} className={`${baseClass} border-b last:border-b-0`}>
                <td className="px-3 py-1.5">{r.label}</td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {formatCurrencyMXN(r.curr, { compact: true })}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground">
                  {formatCurrencyMXN(r.prev, { compact: true })}
                </td>
                <td
                  className={`text-right px-3 py-1.5 tabular-nums ${deltaColor}`}
                >
                  {delta >= 0 ? "+" : ""}
                  {formatCurrencyMXN(delta, { compact: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bg-amber-50 border-t border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1">
        <div>
          <strong>Residual CAPA inflado en 501.01.01:</strong>{" "}
          {formatCurrencyMXN(dResidual, { compact: true })} — diferencia entre
          501.01.01 contable ({formatCurrencyMXN(c.cogs501_01_01, { compact: true })})
          y el costo MP real recursivo ({formatCurrencyMXN(c.cogsRecursivoMp, { compact: true })}).
        </div>
        {c.shrinkage > 200000 ? (
          <div>
            <strong>⚠ Shrinkage atípico (501.01.08):</strong>{" "}
            {formatCurrencyMXN(c.shrinkage, { compact: true })} de pérdida por
            diferencias de conteo físico. Investigar inventario.
          </div>
        ) : null}
      </div>
    </div>
  );
}
