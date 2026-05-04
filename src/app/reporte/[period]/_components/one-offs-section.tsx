import { formatCurrencyMXN } from "@/lib/formatters";
import type { MonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";

export function OneOffsSection({ report }: { report: MonthlyReport }) {
  return (
    <div className="rounded border bg-amber-50/40 p-4 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Eventos no recurrentes detectados en el mes. La utilidad normalizada
        ({formatCurrencyMXN(report.utilidadNormalizada, { compact: true })}) los
        excluye para que puedas comparar manzanas con manzanas vs otros meses.
      </p>
      <ul className="space-y-2.5">
        {report.oneOffs.map((o) => (
          <li
            key={o.category}
            className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-1 border-b border-amber-200 last:border-b-0 pb-2 last:pb-0"
          >
            <div className="flex-1">
              <div className="font-medium">{o.categoryLabel}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {o.reason}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Cuentas: {o.accountCodes.join(", ")}
              </div>
            </div>
            <div className="text-right tabular-nums shrink-0">
              <div className="font-semibold">
                {formatCurrencyMXN(o.amountMxn, { compact: true })}
              </div>
              <div
                className={`text-xs ${o.impactOnUtilityMxn >= 0 ? "text-emerald-700" : "text-red-700"}`}
              >
                {o.impactOnUtilityMxn >= 0 ? "+" : ""}
                {formatCurrencyMXN(o.impactOnUtilityMxn, { compact: true })} a utilidad si se quita
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
