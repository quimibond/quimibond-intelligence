"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { TrendingUp } from "lucide-react";

interface HealthTrendChartProps {
  data: Array<{
    date: string;
    total: number;
    communication?: number;
    financial?: number;
    sentiment?: number;
    responsiveness?: number;
    engagement?: number;
  }>;
  className?: string;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function HealthTrendChart({ data, className }: HealthTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin historial"
        description="No hay datos de tendencia disponibles."
      />
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ minHeight: 200 }}>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="healthGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="hsl(217, 91%, 60%)"
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor="hsl(217, 91%, 60%)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
            width={32}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
              color: "hsl(var(--popover-foreground))",
            }}
            labelFormatter={(label) => formatShortDate(String(label))}
          />
          <Area
            type="monotone"
            dataKey="total"
            name="Score total"
            stroke="hsl(217, 91%, 60%)"
            fill="url(#healthGradient)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
