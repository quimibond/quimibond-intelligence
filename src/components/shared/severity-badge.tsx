import { Badge } from "@/components/ui/badge";

interface SeverityBadgeProps {
  severity: "low" | "medium" | "high" | "critical" | string;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "critical";

const severityVariantMap: Record<string, BadgeVariant> = {
  low: "secondary",
  medium: "info",
  high: "warning",
  critical: "critical",
};

const severityLabelMap: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const variant = severityVariantMap[severity] ?? "secondary";
  const label = severityLabelMap[severity] ?? severity;

  return <Badge variant={variant}>{label}</Badge>;
}
