"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrencyMXN } from "@/lib/formatters";
import type { WaterfallPoint } from "@/lib/queries/sp13/finanzas";

interface Props {
  data: WaterfallPoint[];
}

/**
 * Waterfall P&L: Ingresos → COGS → Utilidad bruta → Gastos op → EBIT → Utilidad neta.
 *
 * Recharts no tiene waterfall nativo, así que usamos un stacked bar donde cada
 * barra tiene dos segmentos: `base` (invisible, offset) y `delta` (visible).
 */
export function PnlWaterfallChart({ data }: Props) {
  // Compute running total and base offsets
  let running = 0;
  const rows = data.map((p) => {
    let base = 0;
    let delta = 0;
    let end = 0;
    if (p.kind === "total") {
      // totals anchor to zero
      base = Math.min(0, p.value);
      delta = Math.abs(p.value);
      end = p.value;
      running = p.value;
    } else {
      const start = running;
      end = running + p.value;
      base = Math.min(start, end);
      delta = Math.abs(p.value);
      running = end;
    }
    return { label: p.label, kind: p.kind, value: p.value, base, delta, end };
  });

  const colorForKind = (kind: WaterfallPoint["kind"]): string => {
    switch (kind) {
      case "positive":
        return "var(--success)";
      case "negative":
        return "var(--danger)";
      case "total":
        return "var(--primary)";
    }
  };

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={(v) => formatCurrencyMXN(Number(v), { compact: true })}
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
            formatter={(value: unknown, _name: unknown, entry: unknown) => {
              const e = entry as { payload?: { value?: number } };
              const v = e?.payload?.value ?? Number(value) ?? 0;
              return [formatCurrencyMXN(v), "Monto"];
            }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" />
          <Bar dataKey="delta" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {rows.map((r, i) => (
              <Cell key={i} fill={colorForKind(r.kind)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
