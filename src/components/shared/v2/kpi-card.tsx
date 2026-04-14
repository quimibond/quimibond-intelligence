import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  /** Tinte del icono y del valor cuando importa destacar el estado. */
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

const sizeConfig = {
  sm: {
    headerPx: "px-4 pt-3 pb-1.5",
    contentPx: "px-4 pb-3",
    title: "text-[10px]",
    value: "text-xl",
    subtitle: "text-[10px]",
    iconBox: "size-7",
    icon: "size-3.5",
    minH: "min-h-[88px]",
  },
  default: {
    headerPx: "px-5 pt-4 pb-2",
    contentPx: "px-5 pb-4",
    title: "text-[11px]",
    value: "text-2xl sm:text-3xl",
    subtitle: "text-xs",
    iconBox: "size-9",
    icon: "size-4",
    minH: "min-h-[112px]",
  },
  lg: {
    headerPx: "px-6 pt-5 pb-2",
    contentPx: "px-6 pb-5",
    title: "text-xs",
    value: "text-3xl sm:text-4xl",
    subtitle: "text-sm",
    iconBox: "size-10",
    icon: "size-5",
    minH: "min-h-[128px]",
  },
};

/** Color del valor + del icono pill cuando el estado importa. */
const toneStyles = {
  default: {
    value: "text-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
  success: {
    value: "text-success",
    iconBg: "bg-success/10 text-success",
  },
  warning: {
    value: "text-warning",
    iconBg: "bg-warning/10 text-warning",
  },
  danger: {
    value: "text-danger",
    iconBg: "bg-danger/10 text-danger",
  },
  info: {
    value: "text-info",
    iconBg: "bg-info/10 text-info",
  },
} as const;

/**
 * KpiCard — building block canónico para métricas. Usa los primitives de
 * shadcn (Card, CardHeader, CardContent) con jerarquía visual clara:
 *
 *   ┌────────────────────────────────┐
 *   │ TITLE                  [icon]  │
 *   │ $24.5M           ↑ +12%        │
 *   │ subtitle                       │
 *   └────────────────────────────────┘
 *
 * - Icono en pill tonalizado (bg-tone/10, text-tone)
 * - Valor en color del tone cuando el estado importa
 * - Hover/active solo si es clickable
 * - Mobile-first: text-2xl base, sm:text-3xl en pantallas grandes
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
  const styles = toneStyles[tone];
  const clickable = !!href;

  const compactDefault = format !== "percent" && format !== "days";
  const displayValue =
    typeof value === "number"
      ? formatValue(value, format, { compact: compact ?? compactDefault })
      : (value ?? "—");

  const cardClass = cn(
    "group gap-0 overflow-hidden py-0 transition-all duration-150",
    sz.minH,
    clickable &&
      "cursor-pointer hover:border-primary/30 hover:shadow-md active:scale-[0.99]",
    className
  );

  const cardInner = (
    <Card className={cardClass}>
      <CardHeader className={cn("flex-row items-start justify-between gap-2", sz.headerPx)}>
        <p
          className={cn(
            "min-w-0 flex-1 truncate font-medium uppercase tracking-wider text-muted-foreground",
            sz.title
          )}
        >
          {title}
        </p>
        {Icon && (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full transition-colors",
              sz.iconBox,
              styles.iconBg
            )}
            aria-hidden
          >
            <Icon className={sz.icon} />
          </div>
        )}
      </CardHeader>

      <CardContent className={cn("flex flex-1 flex-col gap-1.5", sz.contentPx)}>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "font-bold tabular-nums leading-none",
              sz.value,
              styles.value
            )}
          >
            {displayValue}
          </span>
          {trend && (
            <TrendIndicator value={trend.value} good={trend.good ?? "up"} />
          )}
        </div>

        {(subtitle || clickable) && (
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            {subtitle && (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-muted-foreground",
                  sz.subtitle
                )}
              >
                {subtitle}
              </span>
            )}
            {clickable && (
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (clickable) {
    return (
      <Link href={href} aria-label={title} className="block">
        {cardInner}
      </Link>
    );
  }
  return cardInner;
}
