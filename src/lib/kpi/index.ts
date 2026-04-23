export type {
  SourceKind,
  MetricDefinition,
  Comparison,
  DriftInfo,
  KpiResult,
  TimeSeriesPoint,
  TimeSeries,
} from "./types";

export {
  sourceLabel,
  sourceShortLabel,
  sourceColorClass,
  computeDelta,
  driftSeverity,
} from "./format";
export type { DeltaInput } from "./format";
