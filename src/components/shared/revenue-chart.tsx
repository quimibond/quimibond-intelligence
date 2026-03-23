"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

interface RevenueChartProps {
  data: Array<{
    period: string;
    invoiced: number;
    paid: number;
    overdue: number;
  }>;
  className?: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatMonth(period: string): string {
  try {
    const date = new Date(period + (period.length <= 7 ? "-01" : ""));
    return date.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
  } catch {
    return period;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{formatMonth(label)}</p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums">
            {formatCurrency(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function RevenueChart({ data, className }: RevenueChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[250px] items-center justify-center rounded-lg border border-dashed",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No hay datos de revenue disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ minHeight: 250 }}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tickFormatter={formatMonth}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatCurrency}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <RechartsTooltip content={<CustomTooltip />} />
          <Bar
            dataKey="invoiced"
            name="Facturado"
            stackId="revenue"
            fill="hsl(217, 91%, 60%)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="paid"
            name="Pagado"
            stackId="revenue"
            fill="hsl(142, 71%, 45%)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="overdue"
            name="Vencido"
            stackId="revenue"
            fill="hsl(0, 84%, 60%)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
