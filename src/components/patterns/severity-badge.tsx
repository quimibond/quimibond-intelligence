import { StatusBadge } from "./status-badge";

export type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  level: Severity | string;
  className?: string;
  pulse?: boolean; // accepted but ignored in SP6 — motion removed for minimalist aesthetic
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="severity" value={level} />` instead.
 * This wrapper is preserved for back-compat with out-of-scope pages during SP6 foundation.
 */
export function SeverityBadge({ level, className }: SeverityBadgeProps) {
  const allowed: Severity[] = ["critical", "high", "medium", "low"];
  if (allowed.includes(level as Severity)) {
    return <StatusBadge kind="severity" value={level as Severity} density="regular" className={className} />;
  }
  return <StatusBadge kind="generic" value={String(level)} density="regular" className={className} />;
}
