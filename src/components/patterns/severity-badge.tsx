import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  level: Severity | string;
  className?: string;
  pulse?: boolean;
}

const config: Record<
  Severity,
  { label: string; variant: "critical" | "warning" | "info" | "success" }
> = {
  critical: { label: "Crítica", variant: "critical" },
  high: { label: "Alta", variant: "warning" },
  medium: { label: "Media", variant: "info" },
  low: { label: "Baja", variant: "success" },
};

/**
 * SeverityBadge — badge con color semántico para insights / alertas.
 *
 * @example
 * <SeverityBadge level="critical" />  // red pulse
 * <SeverityBadge level="low" />       // green
 */
export function SeverityBadge({
  level,
  className,
  pulse,
}: SeverityBadgeProps) {
  const entry = (config as Record<string, (typeof config)["critical"]>)[level] ?? {
    label: level,
    variant: "info" as const,
  };
  const isCritical = level === "critical";
  return (
    <Badge
      variant={entry.variant}
      className={cn(
        "uppercase tracking-wide text-[10px]",
        pulse && isCritical && "animate-pulse",
        className
      )}
    >
      {entry.label}
    </Badge>
  );
}
