import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { getFiscalRevenueKpi } from "@/lib/queries/fiscal/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Fiscal Revenue KPI card for /finanzas dashboard.
 * Shows: revenue 12m, prev 12m, YoY%.
 * Links to /system?tab=historico-fiscal on click.
 * Server component.
 */
export async function FiscalRevenueKpiCard() {
  const { rev12m, revPrev12m, yoyPct } = await getFiscalRevenueKpi();

  const isPos = yoyPct != null && yoyPct >= 0;
  const yoyColor =
    yoyPct == null
      ? "text-muted-foreground"
      : isPos
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <Link href="/system?tab=historico-fiscal" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      <Card className="cursor-pointer transition-shadow hover:shadow-md active:scale-[0.99]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Revenue Fiscal (SAT · 24 meses)
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums leading-tight">
                {formatCurrencyMXN(rev12m, { compact: true })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                vs {formatCurrencyMXN(revPrev12m, { compact: true })} año anterior
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <TrendingUp className="size-5 text-muted-foreground" aria-hidden />
              {yoyPct != null && (
                <span className={`text-sm font-semibold tabular-nums ${yoyColor}`}>
                  {isPos ? "+" : ""}
                  {yoyPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
