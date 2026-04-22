/**
 * SP6 foundation — semantic chart palette.
 * Values are CSS var references so dark mode switches automatically.
 * For non-semantic multi-series charts (top 5 customers, etc.), use `series`.
 */
export const CHART_PALETTE = {
  positive: "var(--status-ok)",
  warning:  "var(--status-warning)",
  negative: "var(--status-critical)",
  neutral:  "var(--status-info)",
  muted:    "var(--status-muted)",

  aging: {
    current:  "var(--aging-current)",
    d1_30:    "var(--aging-1-30)",
    d31_60:   "var(--aging-31-60)",
    d61_90:   "var(--aging-61-90)",
    d90_plus: "var(--aging-90-plus)",
  },

  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
} as const;

export type ChartPaletteKey =
  | "positive" | "warning" | "negative" | "neutral" | "muted";

export function resolveSeriesColor(
  index: number,
  semantic?: ChartPaletteKey
): string {
  if (semantic) return CHART_PALETTE[semantic];
  return CHART_PALETTE.series[index % CHART_PALETTE.series.length];
}
