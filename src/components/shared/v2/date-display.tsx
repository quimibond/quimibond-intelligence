import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/formatters";

interface DateDisplayProps {
  date: string | Date | null | undefined;
  relative?: boolean;
  className?: string;
}

/**
 * DateDisplay — wrapper canónico para fechas en es-MX.
 *
 * @example
 * <DateDisplay date="2026-04-13" />           // "13 abr 2026"
 * <DateDisplay date="2026-04-13" relative />  // "hace 2 días"
 */
export function DateDisplay({ date, relative, className }: DateDisplayProps) {
  const text = relative ? formatRelative(date) : formatDate(date);
  const iso =
    date && typeof date !== "string"
      ? date.toISOString()
      : typeof date === "string"
        ? date
        : undefined;

  return (
    <time dateTime={iso} className={cn("tabular-nums", className)}>
      {text}
    </time>
  );
}
