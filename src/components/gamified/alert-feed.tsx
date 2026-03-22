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

const severityConfig: Record<string, { variant: "destructive" | "warning" | "info"; pulseClass: string }> = {
  critical: { variant: "destructive", pulseClass: "alert-pulse-critical" },
  high: { variant: "destructive", pulseClass: "alert-pulse-high" },
  medium: { variant: "warning", pulseClass: "alert-pulse-medium" },
  low: { variant: "info", pulseClass: "alert-pulse-low" },
};

export function AlertFeedItem({ title, severity, contactName, createdAt, isRead }: AlertFeedItemProps) {
  const config = severityConfig[severity] || severityConfig.low;

  return (
    <div className={cn(
      "alert-pulse pl-5 py-2 rounded-md transition-colors",
      config.pulseClass,
      !isRead && "bg-[var(--secondary)]/50",
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant={config.variant} className="text-[10px] px-1.5 py-0">
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
