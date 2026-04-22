"use client";

import * as React from "react";
import {
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { CHART_PALETTE, type ChartPaletteKey } from "@/lib/chart-theme";

export type ChartType = "line" | "area" | "bar" | "stackedBar" | "pie" | "sparkline";

export interface ChartSeries {
  key: string;
  label: string;
  color?: ChartPaletteKey | string; // semantic key or any CSS color string
}

export interface ChartProps {
  type: ChartType;
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: ChartSeries[];
  height?: number;
  yFormatter?: (n: number) => string;
  ariaLabel: string; // REQUIRED
  className?: string;
}

function resolveColor(color: ChartSeries["color"], fallbackIndex: number): string {
  if (!color) return CHART_PALETTE.series[fallbackIndex % CHART_PALETTE.series.length];
  const semanticKeys: ChartPaletteKey[] = ["positive", "warning", "negative", "neutral", "muted"];
  if ((semanticKeys as string[]).includes(color)) {
    return CHART_PALETTE[color as ChartPaletteKey];
  }
  return color; // raw CSS (incl. var(--...))
}

export function Chart({
  type,
  data,
  xKey,
  series,
  height,
  yFormatter,
  ariaLabel,
  className,
}: ChartProps) {
  const h = height ?? (type === "sparkline" ? 24 : 240);
  const showAxes = type !== "sparkline" && type !== "pie";
  const showTooltip = type !== "sparkline";

  const content = (() => {
    switch (type) {
      case "line":
      case "sparkline":
        return (
          <LineChart data={data}>
            {showAxes && <XAxis dataKey={xKey} />}
            {showAxes && <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />}
            {showTooltip && (
              <Tooltip
                formatter={yFormatter ? (v: unknown) => yFormatter(Number(v)) : undefined}
              />
            )}
            {showAxes && series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={resolveColor(s.color, i)}
                strokeWidth={type === "sparkline" ? 1.5 : 2}
                dot={type === "sparkline" ? false : { r: 2 }}
                activeDot={type === "sparkline" ? false : { r: 4 }}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <XAxis dataKey={xKey} />
            <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />
            <Tooltip formatter={yFormatter ? (v: unknown) => yFormatter(Number(v)) : undefined} />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={resolveColor(s.color, i)}
                fill={resolveColor(s.color, i)}
                fillOpacity={0.15}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        );

      case "bar":
      case "stackedBar":
        return (
          <BarChart data={data}>
            <XAxis dataKey={xKey} />
            <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />
            <Tooltip formatter={yFormatter ? (v: unknown) => yFormatter(Number(v)) : undefined} />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={resolveColor(s.color, i)}
                stackId={type === "stackedBar" ? "stack" : undefined}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        );

      case "pie": {
        const s = series[0];
        if (!s) return <div />;
        return (
          <PieChart>
            <Tooltip />
            <Pie data={data} dataKey={s.key} nameKey={xKey} outerRadius="80%" isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE.series[i % CHART_PALETTE.series.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      }
    }
  })();

  return (
    <div className={cn("relative", className)}>
      <div role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={h}>
          {content as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {/* Screen-reader data table — sibling of the role=img wrapper so it appears in the a11y tree */}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{String(row[xKey] ?? "")}</td>
              {series.map((s) => (
                <td key={s.key}>{String(row[s.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
