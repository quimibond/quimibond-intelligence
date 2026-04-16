"use client";

import {
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrencyMXN } from "@/lib/formatters";

interface Props {
  data: Array<{
    period: string;
    ingresos: number;
    costoVentas: number;
    utilidadBruta: number;
    utilidadOperativa: number;
  }>;
}

const monthLabels = [
  "ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic",
];

function fmtPeriod(period: string) {
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return `${monthLabels[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

// Identifica el periodo actual (mes en curso) para marcarlo como parcial
// en el chart — evita que el CEO interprete una barra a medio mes como
// caída real vs meses cerrados.
function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function PlHistoryChart({ data }: Props) {
  const nowPeriod = currentPeriod();
  const partialIdx = data.findIndex((d) => d.period === nowPeriod);
  return (
    <div className="h-[260px] w-full">
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
            dataKey="period"
            tickFormatter={fmtPeriod}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
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
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.3 }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => {
              const period = String(v);
              const label = fmtPeriod(period);
              return period === nowPeriod ? `${label} · parcial (mes en curso)` : label;
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
            dataKey="ingresos"
            name="Ingresos"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill="var(--primary)"
                fillOpacity={i === partialIdx ? 0.35 : 1}
                stroke={i === partialIdx ? "var(--primary)" : undefined}
                strokeDasharray={i === partialIdx ? "3 3" : undefined}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="utilidadBruta"
            name="Utilidad bruta"
            stroke="var(--success)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="utilidadOperativa"
            name="Utilidad operativa"
            stroke="var(--warning)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
