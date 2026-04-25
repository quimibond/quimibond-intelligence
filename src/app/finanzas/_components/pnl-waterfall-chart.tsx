import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { WaterfallPoint } from "@/lib/queries/sp13/finanzas";

interface Props {
  data: WaterfallPoint[];
}

/**
 * Waterfall del P&L como lista escalonada estilo estado financiero.
 *
 * En vez de bar chart (confuso, no se ve bien en mobile), usamos una
 * tabla limpia con:
 *  - Filas de movimiento (positivo/negativo) con su monto
 *  - Filas de subtotal con bg destacado y línea superior
 *  - Barra horizontal proporcional a la magnitud (visual rápido)
 *  - % vs ventas (denominador típico de margen)
 *  - Color verde/rojo según signo
 */
export function PnlWaterfallChart({ data }: Props) {
  // Toma "Ventas" como el primer valor positivo no-total (denominador)
  const ventasPoint =
    data.find((p) => p.kind === "positive" && /vent/i.test(p.label)) ??
    data[0];
  const ventas = Math.max(Math.abs(ventasPoint?.value ?? 0), 1);

  // Magnitud máxima de cualquier punto (para el ancho proporcional de la barra)
  const maxMag = Math.max(...data.map((p) => Math.abs(p.value)), ventas);

  // Running total para subtitle de subtotales
  let running = 0;
  const rows = data.map((p) => {
    let acumulado = 0;
    if (p.kind === "total") {
      acumulado = p.value;
      running = p.value;
    } else {
      acumulado = running + p.value;
      running = acumulado;
    }
    return { ...p, acumulado };
  });

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="divide-y">
        {rows.map((r, i) => {
          const isTotal = r.kind === "total";
          const isPositive = r.kind === "positive";
          const isNegative = r.kind === "negative";
          const magnitudePct = (Math.abs(r.value) / maxMag) * 100;
          const pctOfRevenue = (r.value / ventas) * 100;

          if (isTotal) {
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 border-t-2 px-3 py-3 sm:px-4",
                  i === rows.length - 1
                    ? "bg-primary/10 border-primary/40"
                    : "bg-muted/40 border-foreground/10"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      r.value >= 0 ? "text-foreground" : "text-destructive"
                    )}
                  >
                    {r.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {pctOfRevenue >= 0 ? "+" : ""}
                    {pctOfRevenue.toFixed(1)}% de ventas
                  </div>
                </div>
                <div
                  className={cn(
                    "shrink-0 text-right tabular-nums",
                    i === rows.length - 1 ? "text-base font-bold" : "text-sm font-semibold",
                    r.value >= 0 ? "text-foreground" : "text-destructive"
                  )}
                >
                  {formatCurrencyMXN(r.value)}
                </div>
              </div>
            );
          }

          return (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
            >
              {/* Símbolo de operación */}
              <span
                className={cn(
                  "w-3 shrink-0 text-center font-mono text-base font-medium",
                  isPositive ? "text-success" : "text-destructive"
                )}
                aria-hidden
              >
                {isPositive ? "+" : "−"}
              </span>

              {/* Label + barra de magnitud */}
              <div className="min-w-0 flex-1">
                <div className="text-sm">{r.label}</div>
                <div
                  className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isPositive ? "bg-success/60" : "bg-destructive/60"
                    )}
                    style={{ width: `${magnitudePct}%` }}
                  />
                </div>
              </div>

              {/* Monto + % vs ventas */}
              <div className="shrink-0 text-right">
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    isPositive ? "text-success" : "text-destructive"
                  )}
                >
                  {isPositive ? "+" : "−"}
                  {formatCurrencyMXN(Math.abs(r.value))}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {pctOfRevenue >= 0 ? "+" : ""}
                  {pctOfRevenue.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
