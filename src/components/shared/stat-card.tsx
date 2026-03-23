import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}

const trendConfig = {
  up: { icon: TrendingUp, className: "text-emerald-500" },
  down: { icon: TrendingDown, className: "text-red-500" },
  neutral: { icon: Minus, className: "text-muted-foreground" },
} as const;

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
}: StatCardProps) {
  const TrendIcon = trend ? trendConfig[trend].icon : null;
  const trendClass = trend ? trendConfig[trend].className : "";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {TrendIcon && (
            <TrendIcon className={cn("h-4 w-4", trendClass)} />
          )}
        </div>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
