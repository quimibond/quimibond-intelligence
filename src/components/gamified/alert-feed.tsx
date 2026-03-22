"use client";

import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface AlertFeedItemProps {
  id: string;
  title: string;
  severity: string;
  contactName: string;
  createdAt: string;
  isRead: boolean;
}

const severityToBadge: Record<string, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const severityToPulse: Record<string, string> = {
  critical: "alert-pulse-critical",
  high: "alert-pulse-high",
  medium: "alert-pulse-medium",
  low: "alert-pulse-low",
};

export function AlertFeedItem({ title, severity, contactName, createdAt, isRead }: AlertFeedItemProps) {
  return (
    <div className={cn(
      "alert-pulse pl-5 py-2 rounded-md transition-colors",
      severityToPulse[severity] || "",
      !isRead && "bg-[var(--secondary)]",
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant={severityToBadge[severity] || "low"} className="text-[10px] px-1.5 py-0">
              {severity.toUpperCase()}
            </Badge>
            <span className="text-[10px] text-[var(--muted-foreground)]">{contactName}</span>
          </div>
          <p className={cn("text-sm truncate", !isRead && "font-medium")}>{title}</p>
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap shrink-0">
          {timeAgo(createdAt)}
        </span>
      </div>
    </div>
  );
}
