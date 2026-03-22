"use client";

import { cn } from "@/lib/utils";

interface RadarDot {
  x: number; // 0-100
  y: number; // 0-100
  severity: "critical" | "high" | "medium" | "low";
  label: string;
}

interface RadarWidgetProps {
  dots: RadarDot[];
  className?: string;
}

const dotColors = {
  critical: "bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
  high: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]",
  medium: "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.4)]",
  low: "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]",
};

export function RadarWidget({ dots, className }: RadarWidgetProps) {
  return (
    <div className={cn("radar-container", className)}>
      {/* Concentric rings */}
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

      {/* Cross lines */}
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/5" />
      <div className="absolute left-0 right-0 top-1/2 h-px bg-white/5" />

      {/* Sweep */}
      <div className="radar-sweep" />

      {/* Dots */}
      {dots.map((dot, i) => (
        <div
          key={i}
          className={cn("radar-dot", dotColors[dot.severity])}
          style={{ top: `${dot.y}%`, left: `${dot.x}%` }}
          title={dot.label}
        />
      ))}

      {/* Center point */}
      <div className="absolute top-1/2 left-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/50 border border-cyan-400" />
    </div>
  );
}
