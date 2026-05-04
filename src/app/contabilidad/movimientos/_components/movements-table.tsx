import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountMovement } from "@/lib/queries/sp13/finanzas/cross-account-movements";

export function MovementsTable({
  rows,
  period,
  buckets,
}: {
  rows: AccountMovement[];
  period: string;
  buckets: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay movimientos relevantes en esta categoría.
      </p>
    );
  }

  return (
    <div className="rounded border overflow-x-auto text-sm">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Cuenta</th>
            <th className="text-left px-3 py-2 font-medium w-32 text-xs">
              Categoría
            </th>
            <th className="text-right px-3 py-2 font-medium w-28">Mes</th>
            <th className="text-right px-3 py-2 font-medium w-28">
              Run rate 3m
            </th>
            <th className="text-right px-3 py-2 font-medium w-32">
              Δ vs run rate
            </th>
            <th className="text-right px-3 py-2 font-medium w-24">% vs avg</th>
            <th className="text-right px-3 py-2 font-medium w-28">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isIncrease = r.deltaVsAvgAbs > 0;
            const deltaColor = isIncrease ? "text-red-700" : "text-emerald-700";
            return (
              <tr
                key={r.accountCode}
                className={`border-b last:border-b-0 hover:bg-muted/30 transition ${r.isAnomaly ? "bg-amber-50/30" : ""}`}
              >
                <td className="px-3 py-1.5">
                  <Link
                    href={`/contabilidad/cuenta/${r.accountCode}?from=${period}&to=${period}`}
                    className="block group"
                  >
                    <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                      {r.accountCode}
                      {r.isAnomaly ? (
                        <span title="Anomalía: cambio >2× avg o >$500k abs" className="text-amber-700">
                          ⚠
                        </span>
                      ) : null}
                      <ArrowUpRight
                        size={10}
                        className="opacity-0 group-hover:opacity-100 transition"
                      />
                    </div>
                    <div className="text-sm group-hover:underline capitalize">
                      {r.accountName.toLowerCase()}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {buckets[r.bucket] ?? r.bucket}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums font-medium">
                  {formatCurrencyMXN(r.currMxn, { compact: true })}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground">
                  {formatCurrencyMXN(r.avg3mMxn, { compact: true })}
                </td>
                <td
                  className={`text-right px-3 py-1.5 tabular-nums font-semibold ${deltaColor}`}
                >
                  {isIncrease ? "+" : ""}
                  {formatCurrencyMXN(r.deltaVsAvgAbs, { compact: true })}
                </td>
                <td
                  className={`text-right px-3 py-1.5 tabular-nums text-xs ${deltaColor}`}
                >
                  {r.deltaVsAvgPct == null
                    ? "—"
                    : `${r.deltaVsAvgPct >= 0 ? "+" : ""}${r.deltaVsAvgPct.toFixed(0)}%`}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground">
                  {r.deltaYoyPct == null
                    ? "—"
                    : `${r.deltaYoyPct >= 0 ? "+" : ""}${r.deltaYoyPct.toFixed(0)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/10 border-t">
        Δ vs run rate &gt; 0 = peor para utilidad (más gasto o menos ingreso) ·
        ⚠ = anomalía detectada · click cualquier fila para ver detalle de
        proveedores en esa cuenta.
      </p>
    </div>
  );
}
