"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrencyMXN } from "@/lib/formatters";

interface Props {
  data: Array<{ period: string; revenue: number }>;
}

const monthLabels = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function formatPeriod(period: string) {
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return `${monthLabels[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

export function RevenueTrendChart({ data }: Props) {
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="rev-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tickFormatter={formatPeriod}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatCurrencyMXN(Number(v), { compact: true })}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => formatPeriod(String(v))}
            formatter={(v) =>
              [formatCurrencyMXN(Number(v)), "Revenue"] as [string, string]
            }
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#rev-gradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
