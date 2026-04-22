"use client";

import { Chart } from "./chart";

type Datum = { value: number } & Record<string, unknown>;

interface MiniChartProps {
  data: Datum[];
  height?: number;
  color?: "primary" | "success" | "warning" | "danger" | "info";
  variant?: "area" | "line";
  dataKey?: string;
}

const colorVar: Record<string, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
};

/**
 * @deprecated SP6 — use <Chart type="sparkline" /> directly.
 *
 * MiniChart — sparkline inline para KpiCards y tablas.
 * Sin axes, sin tooltip por default.
 */
export function MiniChart({
  data,
  height = 40,
  color = "primary",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  variant = "area", // kept for API compat; both variants map to sparkline
  dataKey = "value",
}: MiniChartProps) {
  if (!data || data.length === 0) {
    return <div style={{ height }} aria-hidden />;
  }

  const strokeColor = colorVar[color] ?? colorVar.primary;
  // Both area and line variants were axis-free inline sparklines — map both to
  // type="sparkline" (Chart's no-axes/no-tooltip mode). The visual difference
  // between area fill and plain line is an acceptable cosmetic change.

  return (
    <div style={{ height }} aria-hidden>
      <Chart
        type="sparkline"
        data={data as Array<Record<string, unknown>>}
        xKey="__x"
        series={[{ key: dataKey, label: dataKey, color: strokeColor }]}
        height={height}
        ariaLabel="mini chart"
      />
    </div>
  );
}
