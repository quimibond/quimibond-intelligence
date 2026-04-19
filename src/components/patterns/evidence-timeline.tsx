import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FileText,
  Mail,
  Package,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type TimelineEventType =
  | "invoice"
  | "order"
  | "delivery"
  | "email"
  | "product"
  | "overdue"
  | "alert"
  | "resolved";

interface TimelineEvent {
  date: string; // ISO date
  type: TimelineEventType;
  label: string;
  detail?: string;
}

interface EvidenceTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const eventConfig: Record<
  TimelineEventType,
  { icon: LucideIcon; dotClass: string; iconClass: string }
> = {
  invoice: {
    icon: FileText,
    dotClass: "bg-info/20",
    iconClass: "text-info",
  },
  order: {
    icon: ShoppingCart,
    dotClass: "bg-primary/20",
    iconClass: "text-primary",
  },
  delivery: {
    icon: Truck,
    dotClass: "bg-primary/20",
    iconClass: "text-primary",
  },
  email: {
    icon: Mail,
    dotClass: "bg-muted",
    iconClass: "text-muted-foreground",
  },
  product: {
    icon: Package,
    dotClass: "bg-muted",
    iconClass: "text-muted-foreground",
  },
  overdue: {
    icon: AlertTriangle,
    dotClass: "bg-warning/20",
    iconClass: "text-warning-foreground",
  },
  alert: {
    icon: AlertTriangle,
    dotClass: "bg-danger/20",
    iconClass: "text-danger",
  },
  resolved: {
    icon: CheckCircle2,
    dotClass: "bg-success/20",
    iconClass: "text-success",
  },
};

/**
 * EvidenceTimeline — muestra la secuencia de eventos que llevaron a un
 * insight, ordenada cronológicamente (más antigua arriba, más nueva abajo).
 *
 * @example
 * <EvidenceTimeline events={[
 *   { date: "2026-01-05", type: "invoice", label: "Factura INV/2025/12/0040 emitida" },
 *   { date: "2026-02-19", type: "overdue", label: "Factura vence sin pago" },
 *   { date: "2026-03-15", type: "email", label: "Último email del cliente" },
 *   { date: "2026-04-14", type: "alert", label: "62 días vencida — excede patrón" },
 * ]} />
 */
export function EvidenceTimeline({
  events,
  className,
}: EvidenceTimelineProps) {
  if (!events || events.length === 0) return null;

  // Sort ascending by date so the narrative flows oldest → newest
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ol className={cn("relative space-y-3", className)}>
      {/* Vertical line */}
      <div
        className="absolute left-[15px] top-1 bottom-1 w-px bg-border"
        aria-hidden
      />

      {sorted.map((event, idx) => {
        const cfg = eventConfig[event.type];
        const Icon = cfg.icon;
        const isLast = idx === sorted.length - 1;
        return (
          <li key={idx} className="relative flex gap-3 pl-0">
            <div
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                cfg.dotClass,
                isLast && "ring-2 ring-offset-2 ring-offset-background ring-primary/30"
              )}
              aria-hidden
            >
              <Icon className={cn("h-4 w-4", cfg.iconClass)} />
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex items-center gap-2">
                <Calendar
                  className="h-3 w-3 text-muted-foreground"
                  aria-hidden
                />
                <time
                  dateTime={event.date}
                  className="text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {formatDate(event.date)}
                </time>
              </div>
              <div className="mt-0.5 text-sm font-medium">{event.label}</div>
              {event.detail && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {event.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
