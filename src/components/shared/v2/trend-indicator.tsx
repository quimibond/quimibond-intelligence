import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/formatters";

interface TrendIndicatorProps {
  /** Valor en porcentaje (12.3 = +12.3%) */
  value: number | null | undefined;
  /** Dirección "buena" — determina si up/down es verde o rojo */
  good?: "up" | "down";
  className?: string;
  hideIcon?: boolean;
}

/**
 * TrendIndicator — flecha + porcentaje con color semántico.
 *
 * @example
 * <TrendIndicator value={12.3} good="up" />   // verde ▲ +12.3%
 * <TrendIndicator value={-5.1} good="down" /> // verde ▼ -5.1%
 */
export function TrendIndicator({
  value,
  good = "up",
  className,
  hideIcon,
}: TrendIndicatorProps) {
  if (value == null || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const direction = value === 0 ? "flat" : value > 0 ? "up" : "down";
  const isGood =
    direction === "flat"
      ? false
      : direction === good;

  const colorClass =
    direction === "flat"
      ? "text-muted-foreground"
      : isGood
        ? "text-success"
        : "text-danger";

  const Icon =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums font-medium",
        colorClass,
        className
      )}
    >
      {!hideIcon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {value > 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}
