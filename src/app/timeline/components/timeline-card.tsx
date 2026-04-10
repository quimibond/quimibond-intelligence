import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { timeAgo } from "@/lib/utils";
import type { TimelineItem, TimelineItemType } from "./types";
import {
  Activity,
  Bell,
  CheckSquare,
  Lightbulb,
  Mail,
} from "lucide-react";

// ── Config ──

const typeConfig: Record<
  TimelineItemType,
  {
    icon: React.ElementType;
    color: string;
    dotColor: string;
    label: string;
    badgeVariant: "info" | "warning" | "success" | "secondary" | "default";
  }
> = {
  alert: { icon: Bell, color: "text-danger", dotColor: "bg-danger", label: "Alerta", badgeVariant: "warning" },
  action: { icon: CheckSquare, color: "text-info", dotColor: "bg-info", label: "Accion", badgeVariant: "info" },
  email: { icon: Mail, color: "text-success", dotColor: "bg-success", label: "Email", badgeVariant: "success" },
  fact: { icon: Lightbulb, color: "text-warning", dotColor: "bg-warning", label: "Hecho", badgeVariant: "secondary" },
  event: { icon: Activity, color: "text-domain-relationships", dotColor: "bg-domain-relationships", label: "Evento", badgeVariant: "default" },
};

export { typeConfig };

// ── Link map ──

const linkMap: Record<string, (rawId: number) => string> = {
  alert: (id) => `/inbox/insight/${id}`,
  email: (id) => `/emails/${id}`,
  action: () => `/actions`,
  fact: () => `/knowledge`,
};

// ── Component ──

interface TimelineCardProps {
  item: TimelineItem;
}

export function TimelineCard({ item }: TimelineCardProps) {
  const cfg = typeConfig[item.type];
  const Icon = cfg.icon;
  const hrefFn = linkMap[item.type];
  const href = hrefFn ? hrefFn(item.rawId) : undefined;

  const content = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          {item.subtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {item.subtitle}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={cfg.badgeVariant} className="text-[10px]">
              {cfg.label}
            </Badge>
            {item.severity && <SeverityBadge severity={item.severity} />}
            {item.priority && (
              <Badge variant="outline" className="text-[10px]">
                {item.priority}
              </Badge>
            )}
            {item.confidence != null && (
              <Badge variant="outline" className="text-[10px]">
                {Math.round(item.confidence * 100)}%
              </Badge>
            )}
            {item.metadata && (
              <span className="text-[10px] text-muted-foreground">
                {item.metadata}
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
        {timeAgo(item.created_at)}
      </span>
    </div>
  );

  const className =
    "block rounded-xl border bg-card text-card-foreground shadow-sm p-4 transition-colors hover:bg-accent/50";

  return (
    <div className="relative pb-8 last:pb-0">
      {/* Dot on the timeline */}
      <div className="absolute -left-[calc(1.5rem+5px)] flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-muted">
        <div className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
      </div>

      {/* Content card */}
      {href ? (
        <Link href={href} className={className}>
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </div>
  );
}
