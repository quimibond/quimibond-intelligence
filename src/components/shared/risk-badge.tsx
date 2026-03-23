import { Badge } from "@/components/ui/badge";

interface RiskBadgeProps {
  level: "low" | "medium" | "high" | string;
}

const riskVariantMap: Record<string, "success" | "warning" | "critical" | "secondary"> = {
  low: "success",
  medium: "warning",
  high: "critical",
};

const riskLabelMap: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};

export function RiskBadge({ level }: RiskBadgeProps) {
  const variant = riskVariantMap[level] ?? "secondary";
  const label = riskLabelMap[level] ?? level;

  return <Badge variant={variant}>{label}</Badge>;
}
