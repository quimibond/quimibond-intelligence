"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";

interface HealthBarProps {
  id: string;
  name: string;
  company: string;
  riskLevel: string;
  sentimentScore: number;
  relationshipScore: number;
}

function getHealthColor(score: number): string {
  if (score >= 70) return "bg-emerald-400";
  if (score >= 40) return "bg-amber-400";
  return "bg-red-400";
}

function getHealthLabel(score: number): string {
  if (score >= 70) return "FUERTE";
  if (score >= 40) return "ESTABLE";
  return "CRITICO";
}

export function HealthBar({ id, name, company, riskLevel, sentimentScore, relationshipScore }: HealthBarProps) {
  // Normalize to 0-100 scale
  const health = Math.round(
    ((sentimentScore + 1) / 2) * 50 + (relationshipScore / 100) * 50,
  );
  const healthClamped = Math.max(0, Math.min(100, health));
  const colorClass = getHealthColor(healthClamped);
  const label = getHealthLabel(healthClamped);

  return (
    <Link
      href={`/contacts/${id}`}
      className="flex items-center gap-3 rounded-md bg-[var(--card)] border border-[var(--border)] p-3 hover:border-[var(--primary)]/30 transition-colors group"
    >
      {/* Avatar placeholder */}
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
        riskLevel === "high" ? "bg-red-500/20 text-red-400" :
        riskLevel === "medium" ? "bg-amber-500/20 text-amber-400" :
        "bg-emerald-500/20 text-emerald-400",
      )}>
        {name.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate group-hover:text-[var(--primary)] transition-colors">
            {name}
          </span>
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wider ml-2 shrink-0",
            healthClamped >= 70 ? "text-emerald-400" :
            healthClamped >= 40 ? "text-amber-400" :
            "text-red-400",
          )}>
            {label} {healthClamped}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="health-bar-track flex-1">
            <div className={cn("health-bar-fill", colorClass)} style={{ width: `${healthClamped}%` }} />
          </div>
          <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">{company || "—"}</span>
        </div>
      </div>
    </Link>
  );
}
