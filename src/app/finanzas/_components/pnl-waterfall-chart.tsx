"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

import { formatCurrencyMXN } from "@/lib/formatters";
import type { WaterfallPoint } from "@/lib/queries/sp13/finanzas";

interface Props {
  data: WaterfallPoint[];
}

interface Row {
  label: string;
  shortLabel: string;
  kind: WaterfallPoint["kind"];
  value: number;
  base: number; // donde empieza la barra (Y)
  end: number; // donde termina (Y)
  // Para barras descendentes (negative), base > end. Para visualizar bien
  // recharts necesita base ≤ end. Calculamos minY y maxY.
  barLow: number; // siempre <= barHigh
  barHigh: number;
  barOffset: number; // para stack: invisible offset
  barHeight: number; // visible height
  isTotal: boolean;
  prevEnd: number | null; // para conectores
}

/**
 * Waterfall chart correctly:
 *  - "total" bars (Utilidad bruta, EBIT, Utilidad neta) anchored to 0
 *  - "positive" bars start at running total, go up
 *  - "negative" bars start at running total, go down
 *  - Connector lines between consecutive bars at the running total
 *  - Value labels above each bar
 */
export function PnlWaterfallChart({ data }: Props) {
  // Compute running totals + bar geometry
  let running = 0;
  const rows: Row[] = data.map((p, i) => {
    const isTotal = p.kind === "total";
    let base = 0;
    let end = 0;
    let prevEnd: number | null = null;

    if (isTotal) {
      // Total: barra anclada en 0
      base = 0;
      end = p.value;
      running = p.value;
    } else {
      base = running;
      end = running + p.value;
      running = end;
    }

    if (i > 0) {
      const prev = data[i - 1];
      // El conector es siempre el running total después del paso anterior
      // Que para total = prev.value, para steps = base of current
      prevEnd = base;
    }

    const barLow = Math.min(base, end);
    const barHigh = Math.max(base, end);

    return {
      label: p.label,
      shortLabel: shortenLabel(p.label),
      kind: p.kind,
      value: p.value,
      base,
      end,
      barLow,
      barHigh,
      barOffset: barLow,
      barHeight: barHigh - barLow,
      isTotal,
      prevEnd,
    };
  });

  // Calcular min/max para domain del axis
  const allYs = rows.flatMap((r) => [r.barLow, r.barHigh, 0]);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);
  const padding = (maxY - minY) * 0.12;
  const yDomain: [number, number] = [
    minY - padding,
    maxY + padding,
  ];

  const colorForKind = (kind: WaterfallPoint["kind"]): string => {
    switch (kind) {
      case "positive":
        return "var(--success, #16a34a)";
      case "negative":
        return "var(--destructive, #dc2626)";
      case "total":
        return "var(--primary, #1e40af)";
    }
  };

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 24, right: 12, left: 0, bottom: 56 }}
          barCategoryGap="22%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="shortLabel"
            tick={{
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={56}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={(v) =>
              formatCurrencyMXN(Number(v), { compact: true })
            }
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <ReferenceLine
            y={0}
            stroke="var(--foreground)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.2 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0]?.payload as Row | undefined;
              if (!p) return null;
              return (
                <div
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 8,
                    fontSize: 12,
                    minWidth: 180,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {p.label}
                  </div>
                  {p.isTotal ? (
                    <div>
                      <span style={{ color: "var(--muted-foreground)" }}>
                        Total acumulado:{" "}
                      </span>
                      <span style={{ fontWeight: 500 }}>
                        {formatCurrencyMXN(p.value)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span style={{ color: "var(--muted-foreground)" }}>
                          Cambio:{" "}
                        </span>
                        <span
                          style={{
                            fontWeight: 500,
                            color:
                              p.value >= 0
                                ? "var(--success, #16a34a)"
                                : "var(--destructive, #dc2626)",
                          }}
                        >
                          {p.value >= 0 ? "+" : ""}
                          {formatCurrencyMXN(p.value)}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted-foreground)" }}>
                          Acumulado tras este paso:{" "}
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          {formatCurrencyMXN(p.end)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            }}
          />
          {/* Stack: offset invisible + delta visible */}
          <Bar dataKey="barOffset" stackId="w" fill="transparent" />
          <Bar
            dataKey="barHeight"
            stackId="w"
            radius={[3, 3, 0, 0]}
            maxBarSize={56}
          >
            {rows.map((r, i) => (
              <Cell key={i} fill={colorForKind(r.kind)} />
            ))}
          </Bar>
          {/* Conectores horizontales entre barras al nivel del prevEnd */}
          {rows.map((r, i) => {
            if (i === 0 || r.prevEnd == null) return null;
            return (
              <ReferenceLine
                key={`conn-${i}`}
                segment={[
                  { x: rows[i - 1].shortLabel, y: r.prevEnd },
                  { x: r.shortLabel, y: r.prevEnd },
                ]}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.45}
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>

      {/* Legend below chart */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ background: "var(--success, #16a34a)" }}
          />
          Entradas
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ background: "var(--destructive, #dc2626)" }}
          />
          Salidas
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ background: "var(--primary, #1e40af)" }}
          />
          Subtotales
        </span>
      </div>
    </div>
  );
}

/** Acortar labels largos para que quepan en mobile */
function shortenLabel(label: string): string {
  return label
    .replace("Ventas de producto", "Ventas")
    .replace("Utilidad bruta", "U. bruta")
    .replace("Gastos op.", "Gastos op")
    .replace("Otros ingresos", "Otros 7xx")
    .replace("Utilidad neta", "U. neta");
}
