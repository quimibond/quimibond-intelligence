import { formatCurrencyMXN } from "@/lib/formatters";
import type { InventoryReconciliation } from "@/lib/queries/sp13/finanzas/inventory-reconciliation";

export function BookVsPhysicalTable({
  recon,
}: {
  recon: InventoryReconciliation;
}) {
  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Cuenta</th>
            <th className="text-left px-3 py-2 font-medium">Concepto</th>
            <th className="text-right px-3 py-2 font-medium w-32">
              Saldo contable
            </th>
            <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">
              Notas
            </th>
          </tr>
        </thead>
        <tbody>
          {recon.buckets.map((b) => (
            <tr key={b.accountCode} className="border-b last:border-b-0">
              <td className="px-3 py-1.5 font-mono text-xs">{b.accountCode}</td>
              <td className="px-3 py-1.5">{b.label}</td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatCurrencyMXN(b.bookValue, { compact: true })}
              </td>
              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                {bucketNote(b.accountCode, recon)}
              </td>
            </tr>
          ))}
          <tr className="font-bold border-t-2 bg-muted/30">
            <td className="px-3 py-1.5" colSpan={2}>
              Total inventario contable
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums">
              {formatCurrencyMXN(recon.bookTotal, { compact: true })}
            </td>
            <td className="px-3 py-1.5"></td>
          </tr>
          <tr className="border-t bg-blue-50/50">
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5 italic">
              Físico calculado (Σ stock × avg_cost)
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums">
              {formatCurrencyMXN(recon.physicalTotal, { compact: true })}
            </td>
            <td className="px-3 py-1.5 text-xs text-muted-foreground">
              {recon.skusWithStock} SKUs con stock
            </td>
          </tr>
          <tr
            className={`font-semibold border-t bg-${recon.drift >= 0 ? "amber" : "red"}-50/40`}
          >
            <td className="px-3 py-1.5" colSpan={2}>
              Drift = físico − contable
            </td>
            <td
              className={`text-right px-3 py-1.5 tabular-nums ${
                recon.drift >= 0 ? "text-amber-800" : "text-red-700"
              }`}
            >
              {recon.drift >= 0 ? "+" : ""}
              {formatCurrencyMXN(recon.drift, { compact: true })}
            </td>
            <td className="px-3 py-1.5 text-xs">
              {Math.abs(recon.drift) < 500_000
                ? "OK — drift dentro de rango aceptable"
                : recon.drift > 0
                  ? "Físico > contable: posibles causas: WIP físico contado como finished, o avg_cost overstated"
                  : "Contable > físico: posibles faltantes no contabilizados"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function bucketNote(code: string, recon: InventoryReconciliation): string {
  if (code === "115.03.01") {
    return "WIP no se compara directo: canonical_products no distingue WIP";
  }
  if (code === "115.02.01" || code === "115.04.01") {
    return "Comparable con físico (raw / finished)";
  }
  if (recon.driftPct != null && code === "115.01.01") {
    return "Genérico — usualmente cerca de 0";
  }
  return "";
}
