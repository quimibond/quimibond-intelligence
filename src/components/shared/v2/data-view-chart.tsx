"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
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

export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "composed";

export interface DataViewSeries {
  dataKey: string;
  label: string;
  /** CSS color — ej. `"var(--chart-1)"` o `"var(--success)"`. */
  color?: string;
  /** Solo composed: "bar" (default) o "line". */
  kind?: "bar" | "line";
  /** Solo composed: "left" (default) o "right" para eje Y secundario. */
  yAxisId?: "left" | "right";
  /** Solo composed/bar: formato para esta serie (sobreescribe valueFormat). */
  valueFormat?: ValueFormat;
}

export type ValueFormat =
  | "number"
  | "currency"
  | "currency-compact"
  | "percent"
  | "decimal-1";

export interface DataViewReferenceLine {
  value: number;
  label?: string;
  /** Eje sobre el que se dibuja. Default "y". */
  axis?: "x" | "y";
  /** CSS color. Default `"var(--destructive)"`. */
  color?: string;
  /** Dasharray SVG. Default `"4 4"`. */
  strokeDasharray?: string;
}

export interface DataViewChartSpec {
  type: ChartType;
  /** Clave del eje categórico (X axis o slice label en pie).
   *  Para scatter es el eje X (numérico). */
  xKey: string;
  /** Series numéricas (ignoradas en scatter salvo para labels/tooltip). */
  series: DataViewSeries[];
  /** Token de formato para el eje Y y el tooltip. */
  valueFormat?: ValueFormat;
  /** Formato para el eje Y secundario (composed con yAxisId="right"). */
  secondaryValueFormat?: ValueFormat;
  /** Si true en bar/area: stack las series. */
  stacked?: boolean;
  /** Altura en px. Default 320. */
  height?: number;
  /** Máx de slices en pie. Default 8. */
  maxPieSlices?: number;
  /** Limita filas renderizadas en la gráfica a las primeras N. */
  topN?: number;
  /** Solo bar: "vertical" (default, barras verticales) o "horizontal". */
  layout?: "vertical" | "horizontal";
  /** Solo scatter: eje Y (numérico). */
  yKey?: string;
  /** Solo scatter: tamaño de bubble (numérico). Opcional. */
  sizeKey?: string;
  /** Columna categórica para colorear barras/puntos dinámicamente.
   *  Tipos soportados: bar, scatter. */
  colorBy?: string;
  /** Mapa valor → color CSS. Si falta un valor, se asigna un chart color por hash. */
  colorMap?: Record<string, string>;
  /** Línea de referencia horizontal o vertical. */
  referenceLine?: DataViewReferenceLine;
}

function resolveFormatter(format?: ValueFormat): (v: number) => string {
  switch (format) {
    case "currency":
      return (v) =>
        "$" +
        v.toLocaleString("es-MX", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
    case "currency-compact":
      return (v) => {
        const abs = Math.abs(v);
        const sign = v < 0 ? "-" : "";
        if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
        if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
        return `${sign}$${abs.toFixed(0)}`;
      };
    case "percent":
      return (v) =>
        `${v.toLocaleString("es-MX", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        })}%`;
    case "decimal-1":
      return (v) =>
        v.toLocaleString("es-MX", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
    case "number":
    default:
      return (v) =>
        v.toLocaleString("es-MX", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
  }
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

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorForRow(
  row: Record<string, unknown>,
  colorBy: string,
  colorMap: Record<string, string> | undefined,
  fallback: string
): string {
  const raw = row[colorBy];
  if (raw == null) return fallback;
  const key = String(raw);
  if (colorMap && colorMap[key]) return colorMap[key];
  return DEFAULT_COLORS[hashString(key) % DEFAULT_COLORS.length];
}

/**
 * DataViewChart — renderiza un recharts chart usando la config v2/shadcn.
 *
 * Tipos soportados:
 * - bar · line · area · pie (clásicos)
 * - scatter (bubble con sizeKey + colorBy)
 * - composed (mix bar + line, opcionalmente con eje Y secundario)
 *
 * Extras:
 * - layout="horizontal" en bar (barras horizontales, xKey en eje Y)
 * - colorBy + colorMap para colorear por categoría
 * - referenceLine para thresholds semánticos
 */
export function DataViewChart({
  data: rawData,
  chart,
  className,
}: DataViewChartProps) {
  const data = React.useMemo(
    () => (chart.topN ? rawData.slice(0, chart.topN) : rawData),
    [rawData, chart.topN]
  );

  const config = React.useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    chart.series.forEach((s, i) => {
      c[s.dataKey] = {
        label: s.label,
        color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      };
    });
    // For colorBy, register each category as an entry so tooltip/legend can find it.
    if (chart.colorBy && chart.colorMap) {
      Object.entries(chart.colorMap).forEach(([k, v]) => {
        c[`__cat_${k}`] = { label: k, color: v };
      });
    }
    return c;
  }, [chart]);

  const height = chart.height ?? 320;

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

  const formatValue = React.useMemo(
    () => resolveFormatter(chart.valueFormat),
    [chart.valueFormat]
  );
  const formatSecondary = React.useMemo(
    () => resolveFormatter(chart.secondaryValueFormat ?? chart.valueFormat),
    [chart.secondaryValueFormat, chart.valueFormat]
  );
  const tickFormatter = (v: number) => formatValue(v);
  const tickFormatterSecondary = (v: number) => formatSecondary(v);

  const referenceEl = chart.referenceLine ? (
    <ReferenceLine
      {...(chart.referenceLine.axis === "x"
        ? { x: chart.referenceLine.value }
        : { y: chart.referenceLine.value })}
      stroke={chart.referenceLine.color ?? "var(--destructive)"}
      strokeDasharray={chart.referenceLine.strokeDasharray ?? "4 4"}
      strokeWidth={1.5}
      label={
        chart.referenceLine.label
          ? {
              value: chart.referenceLine.label,
              position: "insideTopRight",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }
          : undefined
      }
    />
  ) : null;

  return (
    <ChartContainer
      config={config}
      className={cn("w-full", className)}
      style={{ aspectRatio: "auto", height }}
    >
      {chart.type === "bar" ? (
        <BarChart
          data={data}
          layout={chart.layout === "horizontal" ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
        >
          <CartesianGrid
            horizontal={chart.layout !== "horizontal"}
            vertical={chart.layout === "horizontal"}
            strokeDasharray="3 3"
          />
          {chart.layout === "horizontal" ? (
            <>
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={tickFormatter}
              />
              <YAxis
                type="category"
                dataKey={chart.xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={120}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={chart.xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={tickFormatter}
                width={56}
              />
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent indicator="dot" />}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {referenceEl}
          {chart.series.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              fill={`var(--color-${s.dataKey})`}
              radius={
                chart.layout === "horizontal" ? [0, 4, 4, 0] : [4, 4, 0, 0]
              }
              stackId={chart.stacked ? "stack" : undefined}
            >
              {chart.colorBy
                ? data.map((row, i) => (
                    <Cell
                      key={i}
                      fill={colorForRow(
                        row,
                        chart.colorBy!,
                        chart.colorMap,
                        `var(--color-${s.dataKey})`
                      )}
                    />
                  ))
                : null}
            </Bar>
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
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={56}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {referenceEl}
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
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={56}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {referenceEl}
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
      ) : chart.type === "pie" ? (
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
      ) : chart.type === "scatter" ? (
        <ScatterChart margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey={chart.xKey}
            name={chart.series[0]?.label ?? chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={tickFormatter}
          />
          <YAxis
            type="number"
            dataKey={chart.yKey ?? chart.series[0]?.dataKey}
            name={chart.series[1]?.label ?? chart.yKey ?? ""}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatterSecondary}
            width={64}
          />
          {chart.sizeKey ? (
            <ZAxis
              type="number"
              dataKey={chart.sizeKey}
              range={[40, 400]}
              name={chart.sizeKey}
            />
          ) : null}
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={<ChartTooltipContent indicator="dot" />}
          />
          {chart.colorBy && chart.colorMap ? (
            <Legend
              verticalAlign="top"
              height={28}
              content={() => (
                <div className="flex flex-wrap items-center justify-end gap-3 pb-1 pr-2 text-xs text-muted-foreground">
                  {Object.entries(chart.colorMap!).map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: v }}
                      />
                      {k}
                    </span>
                  ))}
                </div>
              )}
            />
          ) : null}
          {referenceEl}
          <Scatter
            data={data}
            fill={chart.series[0]?.color ?? "var(--chart-1)"}
          >
            {chart.colorBy
              ? data.map((row, i) => (
                  <Cell
                    key={i}
                    fill={colorForRow(
                      row,
                      chart.colorBy!,
                      chart.colorMap,
                      "var(--chart-1)"
                    )}
                  />
                ))
              : null}
          </Scatter>
        </ScatterChart>
      ) : (
        // composed
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={tickFormatter}
            width={56}
          />
          {chart.series.some((s) => s.yAxisId === "right") ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={tickFormatterSecondary}
              width={56}
            />
          ) : null}
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          {chart.series.length > 1 && (
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {referenceEl}
          {chart.series.map((s) => {
            const kind = s.kind ?? "bar";
            const axisId = s.yAxisId ?? "left";
            if (kind === "line") {
              return (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  yAxisId={axisId}
                  dataKey={s.dataKey}
                  stroke={`var(--color-${s.dataKey})`}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              );
            }
            return (
              <Bar
                key={s.dataKey}
                yAxisId={axisId}
                dataKey={s.dataKey}
                fill={`var(--color-${s.dataKey})`}
                radius={[4, 4, 0, 0]}
                stackId={chart.stacked ? "stack" : undefined}
              >
                {chart.colorBy
                  ? data.map((row, i) => (
                      <Cell
                        key={i}
                        fill={colorForRow(
                          row,
                          chart.colorBy!,
                          chart.colorMap,
                          `var(--color-${s.dataKey})`
                        )}
                      />
                    ))
                  : null}
              </Bar>
            );
          })}
        </ComposedChart>
      )}
    </ChartContainer>
  );
}
