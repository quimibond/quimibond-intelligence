import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DriftAlertProps {
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}

const TONE = {
  info: {
    Icon: Info,
    ring: "border-info/40 bg-info/5 text-foreground",
    icon: "text-info",
  },
  warning: {
    Icon: AlertTriangle,
    ring: "border-warning/40 bg-warning/5 text-foreground",
    icon: "text-warning",
  },
  critical: {
    Icon: AlertOctagon,
    ring: "border-danger/40 bg-danger/5 text-foreground",
    icon: "text-danger",
  },
} as const;

/**
 * Page-level banner that surfaces a data divergence the user should act on.
 * Use sparingly — one or two per page max.
 */
export function DriftAlert({
  severity,
  title,
  description,
  action,
  className,
}: DriftAlertProps) {
  const t = TONE[severity];
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        t.ring,
        className
      )}
    >
      <t.Icon className={cn("size-5 shrink-0", t.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {action && (
        <Link
          href={action.href}
          className="shrink-0 text-xs font-medium underline underline-offset-2 hover:no-underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
