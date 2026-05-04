import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import type { SkuValueRow } from "@/lib/queries/sp13/finanzas/inventory-reconciliation";

export function TopInventoryByValue({ rows }: { rows: SkuValueRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay SKUs con valor inventariado &gt; $50k.
      </p>
    );
  }
  const total = rows.reduce((s, r) => s + r.totalValueMxn, 0);
  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">#</th>
            <th className="text-left px-3 py-2 font-medium">SKU</th>
            <th className="text-left px-3 py-2 font-medium">Producto</th>
            <th className="text-right px-3 py-2 font-medium w-24">Stock</th>
            <th className="text-right px-3 py-2 font-medium w-24">
              Costo unit.
            </th>
            <th className="text-right px-3 py-2 font-medium w-32">
              Valor total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                {i + 1}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs">
                {r.internalRef ?? "—"}
              </td>
              <td className="px-3 py-1.5 capitalize text-xs">
                {r.name ?? "—"}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatNumber(r.stockQty, { compact: true })}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatCurrencyMXN(r.avgCostMxn)}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums font-semibold">
                {formatCurrencyMXN(r.totalValueMxn, { compact: true })}
              </td>
            </tr>
          ))}
          <tr className="font-semibold border-t-2 bg-muted/30">
            <td colSpan={5} className="px-3 py-1.5">
              Subtotal top {rows.length}
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums">
              {formatCurrencyMXN(total, { compact: true })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
