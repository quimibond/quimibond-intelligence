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
  MonteCarloResult,
} from "@/lib/queries/sp13/finanzas";

interface Props {
  projection: CashProjection;
  monteCarlo?: MonteCarloResult;
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

export function CashProjectionChart({ projection, monteCarlo }: Props) {
  const { points, safetyFloor, markers } = projection;

  // Audit 2026-04-27 finding #22: banda P25-P75 derivada de Monte Carlo
  // sobre el closing balance, escalada linealmente por día (0 hoy, full
  // ancho al closing). Refleja que la incertidumbre crece con el horizonte.
  // Sin monteCarlo o si la banda es despreciable (<0.5% del baseline),
  // no rendereamos para evitar ruido visual.
  const baseline = monteCarlo?.baselineClosingMxn ?? 0;
  const downSpread = monteCarlo
    ? Math.max(0, baseline - monteCarlo.closingP25Mxn)
    : 0;
  const upSpread = monteCarlo
    ? Math.max(0, monteCarlo.closingP75Mxn - baseline)
    : 0;
  const showBand =
    monteCarlo != null &&
    points.length > 1 &&
    Math.abs(baseline) > 0 &&
    (downSpread + upSpread) / Math.max(1, Math.abs(baseline)) > 0.005;
  const enrichedPoints = showBand
    ? points.map((p, i) => {
        const fraction = i / (points.length - 1);
        return {
          ...p,
          balanceP25: p.balance - downSpread * fraction,
          balanceP75: p.balance + upSpread * fraction,
          // Para recharts stacked area: lower bar + delta
          bandLower: p.balance - downSpread * fraction,
          bandWidth: (downSpread + upSpread) * fraction,
        };
      })
    : points;

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={enrichedPoints} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
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
            formatter={(value: unknown, name: unknown) => {
              // Suprimir las series internas usadas para construir la banda
              // (bandLower y bandWidth son tracks visuales, no informativos).
              const n = String(name);
              if (n === "bandLower" || n === "bandWidth") return [null, null];
              return [formatCurrencyMXN(Number(value)), n];
            }}
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
          {showBand && (
            <>
              {/* Banda P25-P75: stacked invisible lower + visible width.
                  Recharts Area stacking emula un range area. */}
              <Area
                type="monotone"
                dataKey="bandLower"
                stackId="band"
                stroke="transparent"
                fill="transparent"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                type="monotone"
                dataKey="bandWidth"
                stackId="band"
                name="Banda P25-P75"
                stroke="transparent"
                fill="var(--primary)"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="balanceP25"
                name="P25"
                stroke="var(--primary)"
                strokeOpacity={0.4}
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="balanceP75"
                name="P75"
                stroke="var(--primary)"
                strokeOpacity={0.4}
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
              />
            </>
          )}
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
