import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ProjectionEvent } from "@/lib/queries/sp13/finanzas";

/**
 * Calendario de eventos del cash projection.
 *
 * Agrupa TODOS los eventos por semana ISO (lunes-domingo). Cada
 * semana es un <details> nativo de HTML (sin client JS), expandible
 * para ver los eventos individuales ordenados por monto desc.
 *
 * Default open: las primeras 2 semanas (esta + próxima).
 * Hasta 12 semanas visibles (cubre horizonte 90d).
 *
 * Cada evento muestra:
 *   - fecha + categoría con tono coloreado
 *   - counterparty (link a /empresas/[id] si tiene companyId)
 *   - days overdue (si aplica) + probabilidad de cobro (inflows)
 *   - monto weighted + nominal si difiere por probability discount
 */
export function ProjectionTimeline({
  events,
  horizonDays,
}: {
  events: ProjectionEvent[];
  horizonDays: number;
}) {
  if (events.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfWeek = (d: Date): Date => {
    const out = new Date(d);
    const dow = out.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    out.setDate(out.getDate() + diff);
    out.setHours(0, 0, 0, 0);
    return out;
  };
  const todayWeek = startOfWeek(today);
  const fmtDayShort = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-MX", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  };
  const fmtWeekRange = (weekStart: Date): string => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const startTxt = weekStart.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    });
    const endTxt = end.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    });
    return `${startTxt} – ${endTxt}`;
  };

  // Agrupa TODOS los eventos por iso de inicio de semana
  const byWeek = new Map<string, ProjectionEvent[]>();
  for (const e of events) {
    const wk = startOfWeek(new Date(e.date));
    const key = wk.toISOString().slice(0, 10);
    const arr = byWeek.get(key) ?? [];
    arr.push(e);
    byWeek.set(key, arr);
  }

  const sortedWeeks = Array.from(byWeek.entries())
    .map(([key, items]) => ({ key, items, weekStart: new Date(key) }))
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .slice(0, 12);

  if (sortedWeeks.length === 0) return null;

  const weekLabel = (weekStart: Date): string => {
    const diffDays = Math.round(
      (weekStart.getTime() - todayWeek.getTime()) / 86400000
    );
    if (diffDays === 0) return "Esta semana";
    if (diffDays === 7) return "Próxima semana";
    return `Semana del ${fmtWeekRange(weekStart)}`;
  };

  const catTone = (e: ProjectionEvent): string => {
    if (e.kind === "inflow") {
      if (e.category === "ar_cobranza")
        return "bg-success/10 text-success border-success/30";
      if (e.category === "ventas_confirmadas")
        return "bg-info/10 text-info border-info/30";
      if (e.category === "runrate_clientes")
        return "bg-warning/10 text-warning border-warning/30";
      return "bg-success/10 text-success border-success/30";
    }
    if (e.category === "impuestos_sat")
      return "bg-warning/10 text-warning border-warning/30";
    if (e.category === "nomina")
      return "bg-primary/10 text-primary border-primary/30";
    return "bg-destructive/10 text-destructive border-destructive/30";
  };

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
        <span>Calendario de eventos · próximos {horizonDays}d</span>
        <span className="font-normal normal-case tracking-normal">
          {events.length} eventos · click semana para ver detalle
        </span>
      </div>
      <div className="divide-y">
        {sortedWeeks.map(({ key, items, weekStart }, weekIdx) => {
          const totalIn = items
            .filter((e) => e.kind === "inflow")
            .reduce((s, e) => s + e.amountMxn, 0);
          const totalOut = items
            .filter((e) => e.kind === "outflow")
            .reduce((s, e) => s + e.amountMxn, 0);
          const net = totalIn - totalOut;
          const inflowCount = items.filter((e) => e.kind === "inflow").length;
          const outflowCount = items.filter((e) => e.kind === "outflow").length;
          const defaultOpen = weekIdx < 2;
          const sortedItems = [...items].sort(
            (a, b) => b.amountMxn - a.amountMxn
          );
          return (
            <details
              key={key}
              open={defaultOpen}
              className="group [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 bg-muted/15 px-3 py-2 text-xs hover:bg-muted/30 sm:px-4">
                <div className="flex items-baseline gap-2">
                  <ChevronRight
                    className="size-3 shrink-0 self-center transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  <span className="font-semibold">{weekLabel(weekStart)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtWeekRange(weekStart)}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 text-[11px]">
                  <span className="text-success tabular-nums">
                    +{fmt(totalIn)}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">
                      ({inflowCount})
                    </span>
                  </span>
                  <span className="text-destructive tabular-nums">
                    −{fmt(totalOut)}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">
                      ({outflowCount})
                    </span>
                  </span>
                  <span
                    className={cn(
                      "min-w-[80px] text-right font-semibold tabular-nums",
                      net >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    Net {net >= 0 ? "+" : ""}
                    {fmt(net)}
                  </span>
                </div>
              </summary>
              <div className="divide-y">
                {sortedItems.map((e, i) => {
                  const counterpartyHref =
                    e.companyId != null ? `/empresas/${e.companyId}` : null;
                  const counterpartyText =
                    e.counterpartyName ?? e.label ?? "—";
                  return (
                    <div
                      key={`${e.date}-${i}`}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm sm:px-4"
                    >
                      <div className="w-[110px] shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {fmtDayShort(e.date)}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          catTone(e)
                        )}
                      >
                        {e.categoryLabel}
                      </span>
                      <div className="min-w-0 flex-1 truncate text-[12px]">
                        {counterpartyHref ? (
                          <Link
                            href={counterpartyHref}
                            className="hover:underline"
                          >
                            {counterpartyText}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {counterpartyText}
                          </span>
                        )}
                        {e.label && e.counterpartyName && e.label !== e.counterpartyName && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            · {e.label}
                          </span>
                        )}
                        {(e.daysOverdue ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] text-warning">
                            · vencido {e.daysOverdue}d
                          </span>
                        )}
                        {e.probability != null && e.kind === "inflow" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            · {Math.round(e.probability * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            e.kind === "inflow"
                              ? "text-success"
                              : "text-destructive"
                          )}
                        >
                          {e.kind === "inflow" ? "+" : "−"}
                          {fmt(e.amountMxn)}
                        </div>
                        {e.kind === "inflow" &&
                          e.nominalAmountMxn > e.amountMxn && (
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              de {fmt(e.nominalAmountMxn)} nominal
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
