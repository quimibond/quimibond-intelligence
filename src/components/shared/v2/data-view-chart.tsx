"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
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
  | "donut"
  | "radial"
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
  /**
   * Click-through serializable: template con placeholders `{key}` que se
   * reemplazan con valores del row clickeado. Ej. `"/companies/{company_id}"`.
   * Se navega vía Next router. Soportado en bar/scatter/composed.
   *
   * IMPORTANTE: es un string (no función) para cruzar el boundary server→client.
   * Si algún placeholder no se puede resolver (valor null/undefined), no navega.
   */
  rowHrefTemplate?: string;
  /**
   * Mostrar el eje Y. Default:
   * - false  para bar/line/area single-series (look shadcn minimalista)
   * - true   para stacked, composed, scatter (requerido por lectura)
   * Override explícito con este prop.
   */
  showYAxis?: boolean;
  /**
   * Tipo de cuadrícula en bar/line/area/composed.
   * Default: "horizontal" (solo líneas horizontales, como shadcn).
   */
  grid?: "none" | "horizontal" | "vertical" | "both";
  /**
   * Solo donut: métrica a mostrar en el centro. Usa el primer series.
   * Default: suma del dataKey formateada con valueFormat.
   */
  donutCenterLabel?: string;
  /**
   * Solo radial/gauge: valor máximo del dominio (default 100).
   */
  radialMax?: number;
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
 * Resuelve un template `"/path/{field}/{other}"` contra un row. Si algún
 * placeholder no se puede resolver (valor null/undefined/""), retorna null.
 */
function resolveRowHref(
  template: string,
  row: Record<string, unknown>
): string | null {
  let missing = false;
  const resolved = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = row[key];
    if (v == null || v === "") {
      missing = true;
      return "";
    }
    return encodeURIComponent(String(v));
  });
  return missing ? null : resolved;
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
  const router = useRouter();
  const data = React.useMemo(
    () => (chart.topN ? rawData.slice(0, chart.topN) : rawData),
    [rawData, chart.topN]
  );

  // Click-through via template serializable (ver DataViewChartSpec.rowHrefTemplate).
  // El template vive en el spec (string) para cruzar el boundary server→client sin
  // riesgo de pasar funciones.
  const handleElementClick = React.useMemo(() => {
    const tpl = chart.rowHrefTemplate;
    if (!tpl) return undefined;
    return (e: unknown) => {
      if (!e || typeof e !== "object") return;
      const candidate = (e as { payload?: Record<string, unknown> })
        .payload;
      const row =
        candidate && typeof candidate === "object"
          ? candidate
          : (e as Record<string, unknown>);
      const href = resolveRowHref(tpl, row);
      if (href) router.push(href);
    };
  }, [chart.rowHrefTemplate, router]);
  const clickableCursor = chart.rowHrefTemplate ? "pointer" : undefined;

  // Click en la leyenda oculta/muestra la serie. Permite aislar métricas.
  const [hiddenSeries, setHiddenSeries] = React.useState<Set<string>>(
    () => new Set()
  );
  const toggleSeries = React.useCallback((key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const visibleSeries = React.useMemo(
    () => chart.series.filter((s) => !hiddenSeries.has(s.dataKey)),
    [chart.series, hiddenSeries]
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
    if (chart.type !== "pie" && chart.type !== "donut") return data;
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

  const showInteractiveLegend =
    chart.series.length > 1 &&
    chart.type !== "pie" &&
    chart.type !== "donut" &&
    chart.type !== "radial" &&
    chart.type !== "scatter";

  // Defaults shadcn-aware: YAxis oculto en single-series bar/line/area para
  // look limpio; visible en stacked, composed, scatter (requiere contexto).
  const showYAxis =
    chart.showYAxis ??
    (chart.type === "scatter" ||
      chart.type === "composed" ||
      chart.stacked === true ||
      chart.layout === "horizontal");

  // Grid por default "horizontal" (solo líneas horizontales, sin puntillado).
  const gridMode = chart.grid ?? "horizontal";
  const gridEl =
    gridMode === "none" ? null : (
      <CartesianGrid
        horizontal={gridMode === "horizontal" || gridMode === "both"}
        vertical={gridMode === "vertical" || gridMode === "both"}
        stroke="var(--border)"
        strokeOpacity={0.4}
      />
    );

  return (
    <div className={cn("space-y-1.5", className)}>
    <ChartContainer
      config={config}
      className="w-full"
      style={{ aspectRatio: "auto", height }}
    >
      {chart.type === "bar" ? (
        <BarChart
          accessibilityLayer
          data={data}
          layout={chart.layout === "horizontal" ? "vertical" : "horizontal"}
          margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
        >
          {gridEl}
          {chart.layout === "horizontal" ? (
            <>
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
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
                minTickGap={32}
                padding={{ left: 12, right: 12 }}
              />
              {showYAxis ? (
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={tickFormatter}
                  width={48}
                />
              ) : null}
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent indicator="dot" />}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          {referenceEl}
          {visibleSeries.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              fill={`var(--color-${s.dataKey})`}
              radius={
                chart.stacked
                  ? 0
                  : chart.layout === "horizontal"
                    ? [0, 4, 4, 0]
                    : [4, 4, 0, 0]
              }
              stackId={chart.stacked ? "stack" : undefined}
              onClick={handleElementClick}
              style={clickableCursor ? { cursor: clickableCursor } : undefined}
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
          accessibilityLayer
          data={data}
          margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
        >
          {gridEl}
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            padding={{ left: 12, right: 12 }}
          />
          {showYAxis ? (
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={tickFormatter}
              width={48}
            />
          ) : null}
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          {referenceEl}
          {visibleSeries.map((s) => (
            <Line
              key={s.dataKey}
              type="natural"
              dataKey={s.dataKey}
              stroke={`var(--color-${s.dataKey})`}
              strokeWidth={2}
              dot={{
                r: 3,
                strokeWidth: 2,
                fill: "var(--background)",
                stroke: `var(--color-${s.dataKey})`,
              }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      ) : chart.type === "area" ? (
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
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
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${s.dataKey})`}
                  stopOpacity={0.1}
                />
              </linearGradient>
            ))}
          </defs>
          {gridEl}
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
          />
          {showYAxis ? (
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={tickFormatter}
              width={48}
            />
          ) : null}
          <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />
          {referenceEl}
          {visibleSeries.map((s) => (
            <Area
              key={s.dataKey}
              type="natural"
              dataKey={s.dataKey}
              stroke={`var(--color-${s.dataKey})`}
              strokeWidth={2}
              fill={`url(#fill-${s.dataKey})`}
              stackId={chart.stacked ? "stack" : undefined}
            />
          ))}
        </AreaChart>
      ) : chart.type === "pie" || chart.type === "donut" ? (
        <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Pie
            data={pieData}
            dataKey={chart.series[0]?.dataKey ?? "value"}
            nameKey={chart.xKey}
            innerRadius={chart.type === "donut" ? "55%" : 0}
            outerRadius="80%"
            paddingAngle={chart.type === "donut" ? 2 : 1}
            strokeWidth={chart.type === "donut" ? 2 : 0}
          >
            {pieData.map((row, i) => (
              <Cell
                key={i}
                fill={
                  chart.colorBy && chart.colorMap
                    ? colorForRow(
                        row,
                        chart.colorBy,
                        chart.colorMap,
                        DEFAULT_COLORS[i % DEFAULT_COLORS.length]
                      )
                    : DEFAULT_COLORS[i % DEFAULT_COLORS.length]
                }
                stroke="var(--background)"
              />
            ))}
            {chart.type === "donut" ? (
              <Label
                content={({ viewBox }) => {
                  if (
                    !viewBox ||
                    typeof (viewBox as { cx?: number }).cx !== "number"
                  ) {
                    return null;
                  }
                  const { cx, cy } = viewBox as { cx: number; cy: number };
                  const total = pieData.reduce(
                    (s, r) =>
                      s +
                      (Number(
                        (r as Record<string, unknown>)[
                          chart.series[0]?.dataKey ?? "value"
                        ]
                      ) || 0),
                    0
                  );
                  const label =
                    chart.donutCenterLabel ?? formatValue(total);
                  return (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={cx}
                        y={cy - 6}
                        className="fill-foreground text-lg font-bold tabular-nums"
                      >
                        {label}
                      </tspan>
                      <tspan
                        x={cx}
                        y={cy + 14}
                        className="fill-muted-foreground text-[11px]"
                      >
                        {chart.series[0]?.label ?? "Total"}
                      </tspan>
                    </text>
                  );
                }}
              />
            ) : null}
          </Pie>
          <ChartLegend
            content={<ChartLegendContent nameKey={chart.xKey} />}
          />
        </PieChart>
      ) : chart.type === "radial" ? (
        <RadialBarChart
          data={pieData}
          startAngle={90}
          endAngle={-270}
          innerRadius="60%"
          outerRadius="95%"
          barSize={18}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, chart.radialMax ?? 100]}
            angleAxisId={0}
            tick={false}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <RadialBar
            dataKey={chart.series[0]?.dataKey ?? "value"}
            background={{ fill: "var(--muted)" }}
            cornerRadius={8}
          >
            {pieData.map((row, i) => (
              <Cell
                key={i}
                fill={
                  chart.colorBy && chart.colorMap
                    ? colorForRow(
                        row,
                        chart.colorBy,
                        chart.colorMap,
                        DEFAULT_COLORS[i % DEFAULT_COLORS.length]
                      )
                    : DEFAULT_COLORS[i % DEFAULT_COLORS.length]
                }
              />
            ))}
          </RadialBar>
          <ChartLegend
            content={<ChartLegendContent nameKey={chart.xKey} />}
          />
        </RadialBarChart>
      ) : chart.type === "scatter" ? (
        <ScatterChart
          accessibilityLayer
          margin={{ left: 12, right: 16, top: 12, bottom: 4 }}
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeOpacity={0.4}
          />
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
            tickMargin={8}
            tickFormatter={tickFormatterSecondary}
            width={56}
          />
          {chart.sizeKey ? (
            <ZAxis
              type="number"
              dataKey={chart.sizeKey}
              range={[60, 400]}
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
            onClick={handleElementClick}
            style={clickableCursor ? { cursor: clickableCursor } : undefined}
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
          accessibilityLayer
          data={data}
          margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
        >
          {gridEl}
          <XAxis
            dataKey={chart.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={tickFormatter}
            width={48}
          />
          {chart.series.some((s) => s.yAxisId === "right") ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={tickFormatterSecondary}
              width={48}
            />
          ) : null}
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          {referenceEl}
          {visibleSeries.map((s) => {
            const kind = s.kind ?? "bar";
            const axisId = s.yAxisId ?? "left";
            if (kind === "line") {
              return (
                <Line
                  key={s.dataKey}
                  type="natural"
                  yAxisId={axisId}
                  dataKey={s.dataKey}
                  stroke={`var(--color-${s.dataKey})`}
                  strokeWidth={2.5}
                  dot={{
                    r: 3,
                    strokeWidth: 2,
                    fill: "var(--background)",
                    stroke: `var(--color-${s.dataKey})`,
                  }}
                  activeDot={{ r: 5 }}
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
                onClick={handleElementClick}
                style={
                  clickableCursor ? { cursor: clickableCursor } : undefined
                }
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
    {showInteractiveLegend && (
      <InteractiveLegend
        series={chart.series}
        hidden={hiddenSeries}
        onToggle={toggleSeries}
      />
    )}
    </div>
  );
}

interface InteractiveLegendProps {
  series: DataViewSeries[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}

/**
 * Leyenda interactiva — click para aislar/mostrar la serie.
 * Reemplaza el ChartLegend de shadcn para soportar toggle y mantener
 * el mismo aspecto visual (color swatch + label).
 */
function InteractiveLegend({
  series,
  hidden,
  onToggle,
}: InteractiveLegendProps) {
  const allHidden = series.every((s) => hidden.has(s.dataKey));
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px]">
      {series.map((s, i) => {
        const isHidden = hidden.has(s.dataKey);
        const color =
          s.color ?? `var(--chart-${(i % 5) + 1})`;
        return (
          <button
            key={s.dataKey}
            type="button"
            onClick={() => onToggle(s.dataKey)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5",
              "transition-opacity hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isHidden ? "opacity-40" : "opacity-100"
            )}
            aria-pressed={!isHidden}
            aria-label={`${isHidden ? "Mostrar" : "Ocultar"} ${s.label}`}
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className={cn(isHidden && "line-through")}>{s.label}</span>
          </button>
        );
      })}
      {allHidden && (
        <span className="text-muted-foreground">
          Todas las series ocultas — click para mostrar
        </span>
      )}
    </div>
  );
}
