"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, TrendingUp, Flame } from "lucide-react";

interface UrgencyItem {
  type: "alert" | "action" | "contact";
  title: string;
  reason: string;
  urgency: number;
}

interface UrgencyPanelProps {
  items: UrgencyItem[];
}

function getUrgencyCssVar(urgency: number): string {
  if (urgency >= 80) return "--severity-critical";
  if (urgency >= 60) return "--severity-high";
  if (urgency >= 40) return "--severity-medium";
  return "--severity-low";
}

function getUrgencyLabel(urgency: number) {
  if (urgency >= 80) return "CRITICO";
  if (urgency >= 60) return "ALTO";
  if (urgency >= 40) return "MEDIO";
  return "BAJO";
}

const typeIcons = {
  alert: AlertTriangle,
  action: Clock,
  contact: TrendingUp,
};

export function UrgencyPanel({ items }: UrgencyPanelProps) {
  const sorted = [...items].sort((a, b) => b.urgency - a.urgency).slice(0, 5);

  return (
    <div className="space-y-2">
      {sorted.map((item, i) => {
        const cssVar = getUrgencyCssVar(item.urgency);
        const Icon = typeIcons[item.type];
        return (
          <div
            key={i}
            className="rounded-md p-3 border border-[var(--border)]"
            style={{ backgroundColor: `color-mix(in srgb, var(${cssVar}) 10%, transparent)` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: `var(${cssVar})` }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: `var(${cssVar})` }}>
                {getUrgencyLabel(item.urgency)}
              </span>
              <div className="flex-1 h-1 rounded-full bg-[var(--secondary)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${item.urgency}%`,
                    backgroundColor: `var(${cssVar})`,
                  }}
                />
              </div>
              <span className="text-[10px] font-bold tabular-nums" style={{ color: `var(${cssVar})` }}>{item.urgency}</span>
            </div>
            <p className="text-sm font-medium truncate">{item.title}</p>
            <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{item.reason}</p>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <div className="text-center py-6 text-sm text-[var(--muted-foreground)]">
          <Flame className="h-6 w-6 mx-auto mb-1 opacity-30" />
          Sin asuntos urgentes
        </div>
      )}
    </div>
  );
}
