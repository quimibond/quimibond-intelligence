"use client";

import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrencyMXN } from "@/lib/formatters";

export interface ProjectedCashFlowChartPoint {
  label: string;
  inflows: number;
  outflows: number;
  closingBalance: number;
}

interface Props {
  data: ProjectedCashFlowChartPoint[];
}

export function ProjectedCashFlowChart({ data }: Props) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={(v) =>
              formatCurrencyMXN(Number(v), { compact: true })
            }
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.25 }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) =>
              [formatCurrencyMXN(Number(value)), name] as [string, string]
            }
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="circle"
          />
          <Bar
            dataKey="inflows"
            name="Entradas"
            fill="var(--success)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Bar
            dataKey="outflows"
            name="Salidas"
            fill="var(--danger)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Line
            type="monotone"
            dataKey="closingBalance"
            name="Saldo proyectado"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
