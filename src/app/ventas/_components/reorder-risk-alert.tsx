import Link from "next/link";
import { AlertTriangle, Phone } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Currency } from "@/components/patterns";
import { cn } from "@/lib/utils";
import type { ReorderRiskSummary } from "@/lib/queries/operational/sales-intelligence";

/**
 * SP13.6 (ventas) — banner crítico equivalente al "Runway" de /finanzas.
 *
 * Visible sólo cuando hay reorder risk en estado `critical`. Muestra el
 * conteo + revenue total en riesgo + top-3 cuentas para llamar hoy.
 */
export function ReorderRiskAlert({ summary }: { summary: ReorderRiskSummary }) {
  if (summary.criticalCount === 0) return null;

  const tone =
    summary.criticalCount >= 5
      ? "danger"
      : summary.criticalCount >= 2
        ? "warning"
        : "info";

  const toneClass = {
    danger: "border-danger bg-danger/10",
    warning: "border-warning bg-warning/10",
    info: "border-info bg-info/10",
  }[tone];

  const iconClass = {
    danger: "text-danger",
    warning: "text-warning",
    info: "text-info",
  }[tone];

  return (
    <Card className={cn("gap-2 border-l-4", toneClass)}>
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className={cn("h-5 w-5 shrink-0", iconClass)} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-2xl font-bold tabular-nums", iconClass)}>
                {summary.criticalCount}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                cuentas en reorden crítico
              </span>
            </div>
            <span className="text-muted-foreground">·</span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                <Currency amount={summary.totalRevenueAtRisk} compact />
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                revenue en riesgo
              </span>
            </div>
            <Link
              href="/ventas#reorder"
              className="ml-auto text-xs font-medium text-primary hover:underline"
            >
              Ver pipeline completo →
            </Link>
          </div>

          {summary.topCritical.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {summary.topCritical.map((c) => (
                <li
                  key={c.company_id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                >
                  <Phone className="h-3 w-3 shrink-0" aria-hidden />
                  <Link
                    href={`/empresas/${c.company_id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {c.company_name ?? "—"}
                  </Link>
                  {c.days_overdue_reorder != null && (
                    <span className="tabular-nums">
                      · {Math.round(c.days_overdue_reorder)}d vencido
                    </span>
                  )}
                  {c.total_revenue != null && (
                    <span className="tabular-nums">
                      · <Currency amount={c.total_revenue} compact />
                    </span>
                  )}
                  {c.salesperson_name && (
                    <span>· {c.salesperson_name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
