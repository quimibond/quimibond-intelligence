import { formatCurrencyMXN } from "@/lib/formatters";
import type { ShrinkageEvent } from "@/lib/queries/sp13/finanzas/shrinkage-tracker";

const INV_LABEL: Record<string, string> = {
  "115.02.01": "Materia prima",
  "115.04.01": "Productos terminados",
  "115.03.01": "WIP",
  "115.01.01": "Inventario gen.",
};

export function ShrinkageRecent({ events }: { events: ShrinkageEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay eventos recientes.
      </p>
    );
  }
  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium w-24">Fecha</th>
            <th className="text-left px-3 py-2 font-medium">SKU</th>
            <th className="text-left px-3 py-2 font-medium">Producto</th>
            <th className="text-left px-3 py-2 font-medium w-32">
              Tipo inventario
            </th>
            <th className="text-right px-3 py-2 font-medium w-28">Pérdida</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                {e.date}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs">
                {e.productRef ?? "—"}
              </td>
              <td className="px-3 py-1.5 text-xs capitalize">
                {e.productName?.replace(/^Cantidad de producto actualizada \(([^)]+)\)\s*-\s*/, "$1: ").slice(0, 70) ?? "—"}
              </td>
              <td className="px-3 py-1.5 text-xs">
                {e.inventoryAccount
                  ? INV_LABEL[e.inventoryAccount] ?? e.inventoryAccount
                  : "—"}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums font-medium text-red-700">
                {formatCurrencyMXN(e.lossMxn, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
