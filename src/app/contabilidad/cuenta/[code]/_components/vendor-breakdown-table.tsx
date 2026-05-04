import Link from "next/link";
import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountVendorBreakdown } from "@/lib/queries/sp13/finanzas/account-expense-detail";

export function VendorBreakdownTable({
  vendors,
  totalMxn,
}: {
  vendors: AccountVendorBreakdown[];
  totalMxn: number;
}) {
  if (vendors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay proveedores registrados en el período.
      </p>
    );
  }
  return (
    <div className="rounded border overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">#</th>
            <th className="text-left px-3 py-2 font-medium">Proveedor</th>
            <th className="text-left px-3 py-2 font-medium w-28 text-xs">
              RFC
            </th>
            <th className="text-right px-3 py-2 font-medium w-20">Facturas</th>
            <th className="text-right px-3 py-2 font-medium w-32">Total</th>
            <th className="text-right px-3 py-2 font-medium w-20">% del mes</th>
          </tr>
        </thead>
        <tbody>
          {vendors.slice(0, 25).map((v, i) => {
            const pct = totalMxn !== 0 ? (v.totalMxn / totalMxn) * 100 : 0;
            return (
              <tr key={i} className="border-b last:border-b-0">
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-3 py-1.5 capitalize">
                  {v.vendorCompanyId ? (
                    <Link
                      href={`/empresas/${v.vendorCompanyId}`}
                      className="hover:underline"
                    >
                      {v.vendorName}
                    </Link>
                  ) : (
                    v.vendorName
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {v.vendorRfc ?? "—"}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {v.invoiceCount}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums font-semibold">
                  {formatCurrencyMXN(v.totalMxn, { compact: true })}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground">
                  {pct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
          <tr className="font-bold border-t-2 bg-muted/30">
            <td colSpan={4} className="px-3 py-1.5">
              Total
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums">
              {formatCurrencyMXN(totalMxn, { compact: true })}
            </td>
            <td className="text-right px-3 py-1.5 tabular-nums text-xs">
              100%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
