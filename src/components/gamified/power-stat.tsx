"use client";

import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface PowerStatProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color: "cyan" | "green" | "red" | "amber" | "purple";
  subtitle?: string;
  className?: string;
  delay?: number;
}

const colorMap: Record<string, { neon: string; cssVar: string }> = {
  cyan:   { neon: "neon-text-cyan",   cssVar: "--accent-cyan" },
  green:  { neon: "neon-text-green",  cssVar: "--success" },
  red:    { neon: "neon-text-red",    cssVar: "--destructive" },
  amber:  { neon: "neon-text-amber",  cssVar: "--warning" },
  purple: { neon: "neon-text-purple", cssVar: "--quest-epic" },
};

export function PowerStat({ label, value, icon: Icon, color, subtitle, className, delay = 0 }: PowerStatProps) {
  const c = colorMap[color];
  const delayClass = delay > 0 ? `float-in-delay-${delay}` : "";

  return (
    <div
      className={cn("game-card rounded-lg p-4 bg-[var(--card)] float-in", delayClass, className)}
      style={{ borderColor: `color-mix(in srgb, var(${c.cssVar}) 20%, transparent)` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: `color-mix(in srgb, var(${c.cssVar}) 10%, transparent)` }}
        >
          <Icon className="h-5 w-5" style={{ color: `var(${c.cssVar})` }} />
        </div>
      </div>
      <div className={cn("text-3xl font-black tabular-nums stat-value", c.neon)}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs font-medium text-[var(--muted-foreground)] mt-1 uppercase tracking-wider">
        {label}
      </div>
      {subtitle && (
        <div className="text-[10px] text-[var(--muted-foreground)] opacity-60 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
