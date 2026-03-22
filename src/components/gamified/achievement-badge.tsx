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

const tierCssVars = {
  gold:   "--achievement-gold",
  silver: "--achievement-silver",
  bronze: "--achievement-bronze",
};

export function AchievementBadge({ icon: Icon, title, description, unlocked, tier }: AchievementBadgeProps) {
  const cssVar = tierCssVars[tier];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg p-3 border transition-all",
        unlocked ? "achievement" : "bg-[var(--secondary)] border-[var(--border)] opacity-40",
      )}
      style={unlocked ? {
        backgroundColor: `color-mix(in srgb, var(${cssVar}) 15%, transparent)`,
        borderColor: `color-mix(in srgb, var(${cssVar}) 30%, transparent)`,
      } : undefined}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border",
          !unlocked && "bg-[var(--secondary)] border-[var(--border)]",
        )}
        style={unlocked ? {
          backgroundColor: `color-mix(in srgb, var(${cssVar}) 15%, transparent)`,
          borderColor: `color-mix(in srgb, var(${cssVar}) 30%, transparent)`,
        } : undefined}
      >
        <Icon
          className="h-5 w-5"
          style={{ color: unlocked ? `var(${cssVar})` : "var(--muted-foreground)" }}
        />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{title}</div>
        <div className="text-[10px] text-[var(--muted-foreground)] truncate">{description}</div>
      </div>
    </div>
  );
}
