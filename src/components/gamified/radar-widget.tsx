"use client";

import { cn } from "@/lib/utils";

interface RadarDot {
  x: number;
  y: number;
  severity: "critical" | "high" | "medium" | "low";
  label: string;
}

interface RadarWidgetProps {
  dots: RadarDot[];
  className?: string;
}

const dotCssVars: Record<string, string> = {
  critical: "--severity-critical",
  high: "--severity-high",
  medium: "--severity-medium",
  low: "--severity-low",
};

export function RadarWidget({ dots, className }: RadarWidgetProps) {
  return (
    <div className={cn("radar-container", className)}>
      {[25, 50, 75].map((size) => (
        <div
          key={size}
          className="radar-ring"
          style={{
            top: `${50 - size / 2}%`,
            left: `${50 - size / 2}%`,
            width: `${size}%`,
            height: `${size}%`,
          }}
        />
      ))}

      <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 5%, transparent)" }} />
      <div className="absolute left-0 right-0 top-1/2 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 5%, transparent)" }} />

      <div className="radar-sweep" />

      {dots.map((dot, i) => {
        const cssVar = dotCssVars[dot.severity] || dotCssVars.low;
        return (
          <div
            key={i}
            className="radar-dot"
            style={{
              top: `${dot.y}%`,
              left: `${dot.x}%`,
              backgroundColor: `var(${cssVar})`,
              boxShadow: `0 0 8px color-mix(in srgb, var(${cssVar}) 60%, transparent)`,
            }}
            title={dot.label}
          />
        );
      })}

      <div
        className="absolute top-1/2 left-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          backgroundColor: "color-mix(in srgb, var(--accent-cyan) 50%, transparent)",
          borderWidth: "1px",
          borderColor: "var(--accent-cyan)",
        }}
      />
    </div>
  );
}
