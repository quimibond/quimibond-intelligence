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

function getHealthLevel(score: number): "high" | "mid" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

function getHealthLabel(score: number): string {
  if (score >= 70) return "FUERTE";
  if (score >= 40) return "ESTABLE";
  return "CRITICO";
}

function getRiskCssVar(risk: string): string {
  if (risk === "high") return "--risk-high";
  if (risk === "medium") return "--risk-medium";
  return "--risk-low";
}

export function HealthBar({ id, name, company, riskLevel, sentimentScore, relationshipScore }: HealthBarProps) {
  const health = Math.round(
    ((sentimentScore + 1) / 2) * 50 + (relationshipScore / 100) * 50,
  );
  const healthClamped = Math.max(0, Math.min(100, health));
  const level = getHealthLevel(healthClamped);
  const label = getHealthLabel(healthClamped);
  const riskVar = getRiskCssVar(riskLevel);

  return (
    <Link
      href={`/contacts/${id}`}
      className="flex items-center gap-3 rounded-md bg-[var(--card)] border border-[var(--border)] p-3 hover:border-[var(--primary)] transition-colors group"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          backgroundColor: `color-mix(in srgb, var(${riskVar}) 15%, transparent)`,
          color: `var(${riskVar})`,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate group-hover:text-[var(--primary)] transition-colors">
            {name}
          </span>
          <span
            className="text-[10px] font-bold uppercase tracking-wider ml-2 shrink-0"
            style={{ color: `var(--health-${level})` }}
          >
            {label} {healthClamped}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="health-bar-track flex-1">
            <div className="health-bar-fill" data-level={level} style={{ width: `${healthClamped}%` }} />
          </div>
          <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">{company || "—"}</span>
        </div>
      </div>
    </Link>
  );
}
