"use client";

import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface AchievementBadgeProps {
  icon: LucideIcon;
  title: string;
  description: string;
  unlocked: boolean;
  tier: "gold" | "silver" | "bronze";
}

const tierColors = {
  gold: {
    bg: "bg-amber-500/15",
    border: "border-amber-500/30",
    icon: "text-amber-400",
    glow: "shadow-amber-500/20",
  },
  silver: {
    bg: "bg-slate-400/15",
    border: "border-slate-400/30",
    icon: "text-slate-300",
    glow: "shadow-slate-400/20",
  },
  bronze: {
    bg: "bg-orange-600/15",
    border: "border-orange-600/30",
    icon: "text-orange-400",
    glow: "shadow-orange-500/20",
  },
};

export function AchievementBadge({ icon: Icon, title, description, unlocked, tier }: AchievementBadgeProps) {
  const colors = tierColors[tier];

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg p-3 border transition-all",
      unlocked
        ? cn(colors.bg, colors.border, "achievement")
        : "bg-[var(--secondary)]/50 border-[var(--border)] opacity-40",
    )}>
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border",
        unlocked
          ? cn(colors.bg, colors.border)
          : "bg-[var(--secondary)] border-[var(--border)]",
      )}>
        <Icon className={cn("h-5 w-5", unlocked ? colors.icon : "text-[var(--muted-foreground)]")} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{title}</div>
        <div className="text-[10px] text-[var(--muted-foreground)] truncate">{description}</div>
      </div>
    </div>
  );
}
