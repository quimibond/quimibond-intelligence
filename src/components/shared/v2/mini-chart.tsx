"use client";

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";

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
 * MiniChart — sparkline inline para KpiCards y tablas.
 * Sin axes, sin tooltip por default.
 */
export function MiniChart({
  data,
  height = 40,
  color = "primary",
  variant = "area",
  dataKey = "value",
}: MiniChartProps) {
  const strokeColor = colorVar[color] ?? colorVar.primary;

  if (!data || data.length === 0) {
    return <div style={{ height }} aria-hidden />;
  }

  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        {variant === "line" ? (
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={strokeColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        ) : (
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`mini-${color}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#mini-${color})`}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
