import { cn } from "@/lib/utils";
import { formatCurrencyMXN, formatPercent, formatNumber } from "@/lib/formatters";

type CurrencyFormat = "currency" | "percent" | "number";

interface CurrencyProps {
  amount: number | null | undefined;
  compact?: boolean;
  format?: CurrencyFormat;
  /** Agrega color semántico según el signo del monto */
  colorBySign?: boolean;
  className?: string;
}

/**
 * Currency — wrapper canónico para mostrar montos.
 * Usar SIEMPRE esto en lugar de format manual.
 *
 * @example
 * <Currency amount={1234567} />          // "$1,234,567"
 * <Currency amount={45000} compact />    // "$45 K"
 * <Currency amount={-12.3} format="percent" />
 */
export function Currency({
  amount,
  compact,
  format = "currency",
  colorBySign,
  className,
}: CurrencyProps) {
  let text: string;
  if (format === "percent") {
    text = formatPercent(amount);
  } else if (format === "number") {
    text = formatNumber(amount, { compact });
  } else {
    text = formatCurrencyMXN(amount, { compact });
  }

  const colorClass =
    colorBySign && amount != null && !Number.isNaN(amount)
      ? amount > 0
        ? "text-success"
        : amount < 0
          ? "text-danger"
          : ""
      : "";

  return (
    <span className={cn("tabular-nums", colorClass, className)}>{text}</span>
  );
}
