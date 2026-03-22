"use client";

import { cn } from "@/lib/utils";

interface XPBarProps {
  level: number;
  currentXP: number;
  maxXP: number;
  label: string;
  className?: string;
}

export function XPBar({ level, currentXP, maxXP, label, className }: XPBarProps) {
  const percentage = Math.min((currentXP / maxXP) * 100, 100);

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[var(--secondary)] border border-cyan-500/30">
        <span className="text-lg font-black level-badge">{level}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {label}
          </span>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
            {currentXP.toLocaleString()} / {maxXP.toLocaleString()} XP
          </span>
        </div>
        <div className="xp-bar-track">
          <div className="xp-bar-fill" style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </div>
  );
}
