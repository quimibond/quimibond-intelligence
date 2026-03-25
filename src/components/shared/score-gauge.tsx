"use client";

import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  value: number | null;
  label: string;
  suffix?: string;
  size?: "sm" | "md" | "lg";
  thresholds?: { good: number; warning: number };
}

export function ScoreGauge({
  value,
  label,
  suffix = "%",
  size = "md",
  thresholds = { good: 80, warning: 50 },
}: ScoreGaugeProps) {
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, v));

  const color =
    v >= thresholds.good
      ? "text-emerald-600 dark:text-emerald-400"
      : v >= thresholds.warning
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const trackColor =
    v >= thresholds.good
      ? "stroke-emerald-500"
      : v >= thresholds.warning
        ? "stroke-amber-500"
        : "stroke-red-500";

  const dims = size === "sm" ? 64 : size === "lg" ? 120 : 88;
  const stroke = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  const radius = (dims - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: dims, height: dims }}>
        <svg
          width={dims}
          height={dims}
          className="-rotate-90"
          viewBox={`0 0 ${dims} ${dims}`}
        >
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-muted/20"
          />
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn(trackColor, "transition-all duration-700")}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "font-bold tabular-nums",
              color,
              size === "sm" ? "text-sm" : size === "lg" ? "text-2xl" : "text-lg"
            )}
          >
            {value != null ? `${Math.round(v)}${suffix}` : "—"}
          </span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}
