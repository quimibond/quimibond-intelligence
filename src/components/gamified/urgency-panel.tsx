"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, TrendingUp, Flame } from "lucide-react";

interface UrgencyItem {
  type: "alert" | "action" | "contact";
  title: string;
  reason: string;
  urgency: number; // 0-100
}

interface UrgencyPanelProps {
  items: UrgencyItem[];
}

function getUrgencyColor(urgency: number) {
  if (urgency >= 80) return { text: "text-red-400", bar: "bg-red-400", bg: "bg-red-500/10" };
  if (urgency >= 60) return { text: "text-amber-400", bar: "bg-amber-400", bg: "bg-amber-500/10" };
  if (urgency >= 40) return { text: "text-cyan-400", bar: "bg-cyan-400", bg: "bg-cyan-500/10" };
  return { text: "text-gray-400", bar: "bg-gray-400", bg: "" };
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
        const colors = getUrgencyColor(item.urgency);
        const Icon = typeIcons[item.type];
        return (
          <div key={i} className={cn("rounded-md p-3 border border-[var(--border)]", colors.bg)}>
            <div className="flex items-center gap-2 mb-1.5">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", colors.text)} />
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", colors.text)}>
                {getUrgencyLabel(item.urgency)}
              </span>
              <div className="flex-1 h-1 rounded-full bg-[var(--secondary)]">
                <div className={cn("h-full rounded-full transition-all", colors.bar)} style={{ width: `${item.urgency}%` }} />
              </div>
              <span className={cn("text-[10px] font-bold tabular-nums", colors.text)}>{item.urgency}</span>
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
