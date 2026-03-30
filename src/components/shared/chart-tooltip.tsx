"use client";

import { formatCurrency } from "@/lib/utils";

interface ChartTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => String(Math.round(v)),
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter && label ? labelFormatter(label) : label;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      {formattedLabel && (
        <p className="mb-1.5 font-medium text-popover-foreground">{formattedLabel}</p>
      )}
      {payload.map((entry: { name: string; value: number; color: string }, i: number) => (
        <p key={i} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums text-popover-foreground">
            {valueFormatter(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function CurrencyTooltip(props: ChartTooltipProps) {
  return <ChartTooltip {...props} valueFormatter={formatCurrency} />;
}
