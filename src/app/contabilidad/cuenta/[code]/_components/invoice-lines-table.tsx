import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountInvoiceLine } from "@/lib/queries/sp13/finanzas/account-expense-detail";

export function InvoiceLinesTable({ lines }: { lines: AccountInvoiceLine[] }) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay líneas en el período.
      </p>
    );
  }
  return (
    <div className="rounded border overflow-x-auto text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium w-24">Fecha</th>
            <th className="text-left px-3 py-2 font-medium w-32">Asiento</th>
            <th className="text-left px-3 py-2 font-medium">Proveedor</th>
            <th className="text-left px-3 py-2 font-medium">Concepto</th>
            <th className="text-right px-3 py-2 font-medium w-28">Monto</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                {l.date}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs">{l.entryName}</td>
              <td className="px-3 py-1.5 text-xs capitalize">
                {l.vendorName}
              </td>
              <td className="px-3 py-1.5 text-xs">
                {(l.description ?? "").slice(0, 80)}
                {l.description && l.description.length > 80 ? "…" : ""}
              </td>
              <td
                className={`text-right px-3 py-1.5 tabular-nums font-medium ${
                  l.netMxn >= 0 ? "" : "text-emerald-700"
                }`}
              >
                {l.netMxn >= 0 ? "" : "−"}
                {formatCurrencyMXN(Math.abs(l.netMxn), { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/10 border-t">
        Montos en verde son créditos (notas de crédito o reversiones que
        reducen el gasto).
      </p>
    </div>
  );
}
