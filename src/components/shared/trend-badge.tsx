import { TrendingUp, Minus, TrendingDown, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TrendBadgeProps {
  trend: "improving" | "stable" | "declining" | "critical" | string;
}

const trendConfig: Record<
  string,
  {
    icon: React.ElementType;
    label: string;
    variant: "success" | "info" | "warning" | "critical";
  }
> = {
  improving: { icon: TrendingUp, label: "Mejorando", variant: "success" },
  stable: { icon: Minus, label: "Estable", variant: "info" },
  declining: { icon: TrendingDown, label: "Declinando", variant: "warning" },
  critical: { icon: AlertTriangle, label: "Critico", variant: "critical" },
};

export function TrendBadge({ trend }: TrendBadgeProps) {
  const config = trendConfig[trend] ?? trendConfig.stable;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
