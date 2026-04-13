import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatValue, type FormatKind } from "@/lib/formatters";
import { TrendIndicator } from "./trend-indicator";

interface KpiTrend {
  value: number;
  direction?: "up" | "down" | "flat";
  good?: "up" | "down";
}

interface KpiCardProps {
  title: string;
  value: number | string | null | undefined;
  format?: FormatKind;
  compact?: boolean;
  subtitle?: string;
  trend?: KpiTrend;
  icon?: LucideIcon;
  href?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

const sizeConfig = {
  sm: {
    padding: "p-3",
    title: "text-[11px]",
    value: "text-lg",
    subtitle: "text-[10px]",
    icon: "h-3.5 w-3.5",
  },
  default: {
    padding: "p-4",
    title: "text-xs",
    value: "text-2xl sm:text-3xl",
    subtitle: "text-xs",
    icon: "h-4 w-4",
  },
  lg: {
    padding: "p-5",
    title: "text-sm",
    value: "text-3xl sm:text-4xl",
    subtitle: "text-sm",
    icon: "h-5 w-5",
  },
};

const toneBorder = {
  default: "",
  success: "border-l-4 border-l-success",
  warning: "border-l-4 border-l-warning",
  danger: "border-l-4 border-l-danger",
  info: "border-l-4 border-l-info",
} as const;

/**
 * KpiCard — building block canónico para métricas.
 * Se usa en TODA página como header metrics.
 *
 * Mobile-first: `text-2xl sm:text-3xl` para legibilidad desde 375px.
 */
export function KpiCard({
  title,
  value,
  format = "number",
  compact,
  subtitle,
  trend,
  icon: Icon,
  href,
  size = "default",
  tone = "default",
  className,
}: KpiCardProps) {
  const sz = sizeConfig[size];
  const clickable = !!href;

  const compactDefault = format !== "percent" && format !== "days";
  const displayValue =
    typeof value === "number"
      ? formatValue(value, format, { compact: compact ?? compactDefault })
      : (value ?? "—");

  const content = (
    <div className={cn("flex h-full flex-col gap-1.5", sz.padding)}>
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "font-medium uppercase tracking-wide text-muted-foreground",
            sz.title
          )}
        >
          {title}
        </p>
        {Icon && (
          <Icon
            className={cn("shrink-0 text-muted-foreground", sz.icon)}
            aria-hidden
          />
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className={cn("font-bold tabular-nums leading-none", sz.value)}>
          {displayValue}
        </span>
      </div>

      {(subtitle || trend) && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {trend && (
            <TrendIndicator value={trend.value} good={trend.good ?? "up"} />
          )}
          {subtitle && (
            <span
              className={cn(
                "truncate text-muted-foreground",
                sz.subtitle,
                trend && "ml-auto text-right"
              )}
            >
              {subtitle}
            </span>
          )}
          {clickable && (
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
      )}
    </div>
  );

  const cardClass = cn(
    "min-h-[96px] gap-0 py-0 transition-colors",
    toneBorder[tone],
    clickable && "cursor-pointer hover:bg-accent/40 active:bg-accent/60",
    className
  );

  if (clickable) {
    return (
      <Link href={href} aria-label={title} className="block">
        <Card className={cardClass}>{content}</Card>
      </Link>
    );
  }

  return <Card className={cardClass}>{content}</Card>;
}
