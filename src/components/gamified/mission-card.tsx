"use client";

import { cn } from "@/lib/utils";
import { Swords, Clock, CircleDot } from "lucide-react";

interface MissionCardProps {
  title: string;
  contact: string;
  priority: "high" | "medium" | "low";
  dueDate?: string;
  type: string;
}

const priorityConfig = {
  high:   { class: "mission-epic",   label: "EPICA",  cssVar: "--quest-epic" },
  medium: { class: "mission-rare",   label: "RARA",   cssVar: "--quest-rare" },
  low:    { class: "mission-common", label: "COMUN",  cssVar: "--quest-common" },
};

export function MissionCard({ title, contact, priority, dueDate, type }: MissionCardProps) {
  const config = priorityConfig[priority] || priorityConfig.low;
  const isOverdue = dueDate && new Date(dueDate) < new Date();

  return (
    <div className={cn(
      "rounded-md bg-[var(--card)] border border-[var(--border)] p-3",
      config.class,
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CircleDot className="h-3 w-3 shrink-0" style={{ color: `var(${config.cssVar})` }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `var(${config.cssVar})` }}>
              {config.label}
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--secondary)] px-1.5 py-0.5 rounded">
              {type}
            </span>
          </div>
          <p className="text-sm truncate">{title}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
              <Swords className="h-3 w-3" /> {contact}
            </span>
            {dueDate && (
              <span className={cn(
                "text-xs flex items-center gap-1",
                isOverdue ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]",
              )}>
                <Clock className="h-3 w-3" />
                {new Date(dueDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                {isOverdue && " !"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
