"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CollectionLatencyMonth } from "@/lib/queries/sp13/finanzas";

interface Props {
  months: CollectionLatencyMonth[];
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

export function CollectionLatencyChart({ months }: Props) {
  if (months.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Sin datos suficientes en el período.
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={months}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonth}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis
            yAxisId="days"
            tickFormatter={(v) => `${v}d`}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <YAxis
            yAxisId="sample"
            orientation="right"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => fmtMonth(String(v))}
          />
          <Bar
            yAxisId="sample"
            dataKey="sampleSize"
            name="# facturas"
            fill="var(--muted)"
            fillOpacity={0.5}
          />
          <Line
            yAxisId="days"
            type="monotone"
            dataKey="p50DelayDays"
            name="p50 (mediana)"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="days"
            type="monotone"
            dataKey="p75DelayDays"
            name="p75"
            stroke="var(--warning)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
          />
          <Line
            yAxisId="days"
            type="monotone"
            dataKey="p90DelayDays"
            name="p90"
            stroke="var(--destructive)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
