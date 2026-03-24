"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

interface HealthRadarProps {
  communication: number;
  financial: number;
  sentiment: number;
  responsiveness: number;
  engagement: number;
  payment?: number;
  className?: string;
}

export function HealthRadar({
  communication,
  financial,
  sentiment,
  responsiveness,
  engagement,
  payment,
  className,
}: HealthRadarProps) {
  const data = [
    { dimension: "Comunicacion", value: communication },
    { dimension: "Financiero", value: financial },
    { dimension: "Sentimiento", value: sentiment },
    { dimension: "Responsividad", value: responsiveness },
    { dimension: "Engagement", value: engagement },
    ...(payment != null ? [{ dimension: "Pagos", value: payment }] : []),
  ];

  return (
    <div className={cn("w-full", className)} style={{ minHeight: 250 }}>
      <ResponsiveContainer width="100%" height={250}>
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{
              fill: "hsl(var(--muted-foreground))",
              fontSize: 12,
            }}
          />
          <Radar
            name="Salud"
            dataKey="value"
            stroke="hsl(217, 91%, 60%)"
            fill="hsl(217, 91%, 60%)"
            fillOpacity={0.25}
            dot={{ r: 3, fill: "hsl(217, 91%, 60%)" }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
