"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export type ChartType = "bar" | "line" | "area" | "pie";

export interface DataViewSeries {
  dataKey: string;
  label: string;
  /** CSS color — ej. `"var(--chart-1)"` o `"var(--success)"`. */
  color?: string;
}

export interface DataViewChartSpec {
  type: ChartType;
  /** Clave del eje categórico (X axis o slice label en pie). */
  xKey: string;
  /** Series numéricas. */
  series: DataViewSeries[];
  /** Formateador de valores (ej. currency compact). */
  valueFormatter?: (v: number) => string;
  /** Formateador del label del eje X. */
  xFormatter?: (v: unknown) => string;
  /** Si true en bar: stack las series. */
  stacked?: boolean;
  /** Altura en px. Default 320. */
  height?: number;
  /** Máx de slices en pie (el resto se agrupa como "Otros"). Default 8. */
  maxPieSlices?: number;
}

interface DataViewChartProps {
  data: Record<string, unknown>[];
  chart: DataViewChartSpec;
  className?: string;
}

const DEFAULT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * DataViewChart — renderiza un recharts chart usando la config v2/shadcn.
 *
 * Client component: recharts no es SSR-friendly. Se renderiza solo cuando
 * `view=chart` en la URL (ver DataView wrapper).
 */
export function DataViewChart({ data, chart, className }: DataViewChartProps) {
  const config = React.useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    chart.series.forEach((s, i) => {
      c[s.dataKey] = {
        label: s.label,
        color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      };
    });
    return c;
  }, [chart]);

  const height = chart.height ?? 320;

  // Pie uses first series only; aggregate tail into "Otros" when large.
  const pieData = React.useMemo(() => {
    if (chart.type !== "pie") return data;
    const series = chart.series[0];
    if (!series) return [];
    const max = chart.maxPieSlices ?? 8;
    if (data.length <= max) return data;
    const sorted = [...data].sort(
      (a, b) =>
        (Number(b[series.dataKey]) || 0) - (Number(a[series.dataKey]) || 0)
    );
    const top = sorted.slice(0, max - 1);
    const rest = sorted.slice(max - 1);
    const restTotal = rest.reduce(
      (sum, r) => sum + (Number(r[series.dataKey]) || 0),
      0
    );
    return [
      ...top,
      { [chart.xKey]: "Otros", [series.dataKey]: restTotal },
    ];
  }, [chart, data]);

  const tickFormatter = chart.valueFormatter
    ? (v: number) => chart.valueFormatter!(v)
    : undefined;

  const categoryTick = chart.xFormatter
    ? (v: unknown) => chart.xFormatter!(v)
    : undefined;

  return (
    <ChartContainer
      config={config}
      className={cn("w-full", className)}
      style={{ aspectRatio: "auto", height }}
    >
      {chart.type === "bar" ? (
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={categoryTick}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={tickFormatter ? 56 : 40}
          />
          <ChartTooltip
            content={<ChartTooltipContent indicator="dot" />}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {chart.series.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              fill={`var(--color-${s.dataKey})`}
              radius={[4, 4, 0, 0]}
              stackId={chart.stacked ? "stack" : undefined}
            />
          ))}
        </BarChart>
      ) : chart.type === "line" ? (
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={categoryTick}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={tickFormatter ? 56 : 40}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {chart.series.map((s) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              stroke={`var(--color-${s.dataKey})`}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      ) : chart.type === "area" ? (
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
        >
          <defs>
            {chart.series.map((s) => (
              <linearGradient
                key={s.dataKey}
                id={`fill-${s.dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={`var(--color-${s.dataKey})`}
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${s.dataKey})`}
                  stopOpacity={0.05}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={categoryTick}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={tickFormatter ? 56 : 40}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {chart.series.map((s) => (
            <Area
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              stroke={`var(--color-${s.dataKey})`}
              strokeWidth={2}
              fill={`url(#fill-${s.dataKey})`}
              stackId={chart.stacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      ) : (
        <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={pieData}
            dataKey={chart.series[0]?.dataKey ?? "value"}
            nameKey={chart.xKey}
            innerRadius="45%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {pieData.map((_, i) => (
              <Cell
                key={i}
                fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey={chart.xKey} />} />
        </PieChart>
      )}
    </ChartContainer>
  );
}
