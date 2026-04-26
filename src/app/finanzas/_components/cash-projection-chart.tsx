"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  CashProjection,
  CashProjectionMarker,
} from "@/lib/queries/sp13/finanzas";

interface Props {
  projection: CashProjection;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function markerColor(m: CashProjectionMarker): string {
  if (m.kind === "inflow") return "var(--success)";
  if (m.category === "impuestos_sat") return "var(--warning)";
  return "var(--destructive)";
}

function markerRadius(m: CashProjectionMarker): number {
  if (m.amount >= 1000000) return 7;
  if (m.amount >= 250000) return 6;
  return 5;
}

export function CashProjectionChart({ projection }: Props) {
  const { points, safetyFloor, markers } = projection;

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cashArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => formatCurrencyMXN(Number(v), { compact: true })}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => fmtDate(String(v))}
            formatter={(value: unknown, name: unknown) => [
              formatCurrencyMXN(Number(value)),
              String(name),
            ]}
          />
          <ReferenceLine
            y={safetyFloor}
            stroke="var(--warning)"
            strokeDasharray="4 4"
            label={{
              value: "Mín. seguro",
              position: "insideTopRight",
              fill: "var(--warning)",
              fontSize: 10,
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            name="Saldo proyectado"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#cashArea)"
          />
          <Line
            type="monotone"
            dataKey="balance"
            stroke="transparent"
            dot={false}
            name=""
            legendType="none"
          />
          {markers.slice(0, 25).map((m: CashProjectionMarker, i) => {
            const pt = points.find((p) => p.date === m.date);
            if (!pt) return null;
            return (
              <ReferenceDot
                key={`${m.date}-${i}`}
                x={m.date}
                y={pt.balance}
                r={markerRadius(m)}
                fill={markerColor(m)}
                stroke="var(--card)"
                strokeWidth={2}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
