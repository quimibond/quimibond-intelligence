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

const colorMap = {
  cyan: {
    text: "neon-text-cyan",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    icon: "text-cyan-400",
  },
  green: {
    text: "neon-text-green",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    icon: "text-emerald-400",
  },
  red: {
    text: "neon-text-red",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    icon: "text-red-400",
  },
  amber: {
    text: "neon-text-amber",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    icon: "text-amber-400",
  },
  purple: {
    text: "neon-text-purple",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    icon: "text-purple-400",
  },
};

export function PowerStat({ label, value, icon: Icon, color, subtitle, className, delay = 0 }: PowerStatProps) {
  const colors = colorMap[color];
  const delayClass = delay > 0 ? `float-in-delay-${delay}` : "";

  return (
    <div
      className={cn(
        "game-card rounded-lg p-4",
        "bg-[var(--card)]",
        colors.border,
        "float-in",
        delayClass,
        className,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={cn("p-2 rounded-lg", colors.bg)}>
          <Icon className={cn("h-5 w-5", colors.icon)} />
        </div>
      </div>
      <div className={cn("text-3xl font-black tabular-nums stat-value", colors.text)}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs font-medium text-[var(--muted-foreground)] mt-1 uppercase tracking-wider">
        {label}
      </div>
      {subtitle && (
        <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
