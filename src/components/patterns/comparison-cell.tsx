import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatValue, type FormatKind } from "@/lib/formatters";
import type { Comparison } from "@/lib/kpi";

export interface ComparisonCellProps {
  value: number;
  comparison: Comparison | null;
  format?: FormatKind;
  /** "up" means good (green) / "down" means bad (red). Default: "up". */
  goodDirection?: "up" | "down";
  compact?: boolean;
}

/**
 * Table cell that shows a value plus its delta vs a comparison period.
 * When comparison is null, shows an em-dash for the delta row.
 */
export function ComparisonCell({
  value,
  comparison,
  format = "currency",
  goodDirection = "up",
  compact = true,
}: ComparisonCellProps) {
  const valueDisplay = formatValue(value, format, { compact });
  if (!comparison) {
    return (
      <div className="flex flex-col items-end">
        <span className="tabular-nums">{valueDisplay}</span>
        <span className="text-[10px] text-muted-foreground">—</span>
      </div>
    );
  }
  const isGood =
    comparison.direction === "flat"
      ? null
      : comparison.direction === goodDirection;
  const tone =
    isGood === null
      ? "text-muted-foreground"
      : isGood
        ? "text-success"
        : "text-danger";
  const Icon =
    comparison.direction === "flat"
      ? Minus
      : comparison.direction === "up"
        ? ArrowUp
        : ArrowDown;
  const pct = comparison.deltaPct;
  const pctStr =
    pct == null
      ? "n/a"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums">{valueDisplay}</span>
      <span className={cn("inline-flex items-center gap-0.5 text-[10px]", tone)}>
        <Icon className="size-2.5" aria-hidden />
        {pctStr}
      </span>
    </div>
  );
}
