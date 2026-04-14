import { cn } from "@/lib/utils";
import { formatValue, type FormatKind } from "@/lib/formatters";

interface MetricRowProps {
  label: string;
  /** Puede ser número (se formatea), string o cualquier ReactNode (JSX crudo) */
  value: React.ReactNode;
  format?: FormatKind;
  compact?: boolean;
  alert?: boolean;
  className?: string;
  hint?: string;
}

/**
 * MetricRow — fila label / valor para listas de métricas en Company 360,
 * finance detail, etc. Acepta ReactNode para permitir componentes custom
 * (CompanyLink, DateDisplay, Currency, etc).
 */
export function MetricRow({
  label,
  value,
  format = "number",
  compact,
  alert,
  className,
  hint,
}: MetricRowProps) {
  const display =
    typeof value === "number"
      ? formatValue(value, format, { compact })
      : value == null
        ? "—"
        : value;

  return (
    <div
      className={cn(
        "flex min-h-[44px] items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0",
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      <span
        className={cn(
          "text-right text-sm font-semibold tabular-nums",
          alert && "text-danger"
        )}
      >
        {display}
      </span>
    </div>
  );
}
