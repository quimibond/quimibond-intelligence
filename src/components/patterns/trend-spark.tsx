import { Chart } from "./chart";
import type { ChartPaletteKey } from "@/lib/chart-theme";

interface TrendSparkProps {
  values: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  className?: string;
}

function classifyTrend(values: number[]): { key: "up" | "down" | "flat"; color: ChartPaletteKey } {
  if (values.length < 2) return { key: "flat", color: "muted" };
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return { key: last > 0 ? "up" : last < 0 ? "down" : "flat", color: last > 0 ? "positive" : last < 0 ? "negative" : "muted" };
  const pct = (last - first) / Math.abs(first);
  if (pct > 0.02) return { key: "up", color: "positive" };
  if (pct < -0.02) return { key: "down", color: "negative" };
  return { key: "flat", color: "muted" };
}

export function TrendSpark({ values, ariaLabel, width, height, className }: TrendSparkProps) {
  const data = values.map((v, i) => ({ i, v }));
  const trend = classifyTrend(values);
  return (
    <div data-trend={trend.key} style={{ width: width ?? 60, height: height ?? 20 }} className={className}>
      <Chart
        type="sparkline"
        data={data}
        xKey="i"
        series={[{ key: "v", label: ariaLabel, color: trend.color }]}
        ariaLabel={ariaLabel}
        height={height ?? 20}
      />
    </div>
  );
}
