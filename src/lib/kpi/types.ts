/** Canonical data source labels for SP13. Keep small; extend only if a
 *  sub-spec truly needs more granularity. */
export type SourceKind = "sat" | "pl" | "odoo" | "canonical";

/** Human-readable metadata so every KPI can self-explain. */
export interface MetricDefinition {
  title: string;
  description: string;
  formula: string;
  table: string;
}

/** Contextual delta for a KPI: vs prior period, vs target, etc. */
export interface Comparison {
  label: string; // e.g. "vs mes anterior", "YoY"
  priorValue: number;
  delta: number;
  deltaPct: number | null; // null when priorValue is 0
  direction: "up" | "down" | "flat";
}

/** Cross-source drift signal. Surfaces when sources disagree. */
export interface DriftInfo {
  severity: "info" | "warning" | "critical";
  message: string;
}

/** Single-value KPI result. */
export interface KpiResult<T = number> {
  value: T;
  asOfDate: string; // ISO date
  source: SourceKind;
  definition: MetricDefinition;
  comparison: Comparison | null;
  /** Present when the metric has multiple data sources to compare. */
  sources?: Array<{
    source: SourceKind;
    value: T;
    diffFromPrimary: T;
    diffPct: number; // (diffFromPrimary / primary) * 100
  }>;
  drift: DriftInfo | null;
}

/** One point on a time series. */
export interface TimeSeriesPoint<T = number> {
  period: string; // "YYYY-MM" or "YYYY-MM-DD" per caller
  value: T;
  source: SourceKind;
}

/** Time-series result. Carries both the selected and the full available range. */
export interface TimeSeries<T = number> {
  points: TimeSeriesPoint<T>[];
  fullRange: { earliest: string; latest: string };
  selectedRange: { from: string; to: string };
  source: SourceKind;
}
