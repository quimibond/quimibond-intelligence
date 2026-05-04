import { formatCurrencyMXN } from "@/lib/formatters";
import type { ShrinkageBySku } from "@/lib/queries/sp13/finanzas/shrinkage-tracker";

export function ShrinkageTopSkus({ rows }: { rows: ShrinkageBySku[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Sin shrinkage registrado en el período.
      </p>
    );
  }
  const total = rows.reduce((s, r) => s + r.totalLossMxn, 0);
  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">#</th>
            <th className="text-left px-3 py-2 font-medium">SKU</th>
            <th className="text-left px-3 py-2 font-medium">Producto</th>
            <th className="text-right px-3 py-2 font-medium w-20">Eventos</th>
            <th className="text-right px-3 py-2 font-medium w-20">Meses</th>
            <th className="text-right px-3 py-2 font-medium w-32">
              Pérdida total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const recurrent = r.monthsAffected >= 3;
            return (
              <tr
                key={i}
                className={`border-b last:border-b-0 ${
                  recurrent ? "bg-red-50/30" : ""
                }`}
              >
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {r.productRef ?? "—"}
                </td>
                <td className="px-3 py-1.5 capitalize text-xs">
                  {r.productName?.slice(0, 80) ?? "—"}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {r.events}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {r.monthsAffected}
                  {recurrent ? (
                    <span title="Pérdida recurrente (3+ meses)" className="text-red-700 ml-1">
                      ●
                    </span>
                  ) : null}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums font-semibold text-red-700">
                  {formatCurrencyMXN(r.totalLossMxn, { compact: true })}
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold border-t-2 bg-muted/30">
            <td colSpan={5} className="px-3 py-1.5">
              Subtotal top {rows.length}
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums text-red-700">
              {formatCurrencyMXN(total, { compact: true })}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/10 border-t">
        ● = pérdida recurrente en 3+ meses · investiga proceso de conteo o flujo
        físico de ese SKU.
      </p>
    </div>
  );
}
