import { Badge } from "@/components/ui/badge";

interface RiskBadgeProps {
  level: string | null | undefined;
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
  const key = level ?? "low";
  const variant = riskVariantMap[key] ?? "secondary";
  const label = riskLabelMap[key] ?? key;

  return <Badge variant={variant}>{label}</Badge>;
}
