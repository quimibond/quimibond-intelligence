import { describe, it, expectTypeOf } from "vitest";
import type {
  SourceKind,
  Comparison,
  MetricDefinition,
  DriftInfo,
  KpiResult,
  TimeSeries,
  TimeSeriesPoint,
} from "@/lib/kpi";

describe("SP13 KPI types", () => {
  it("SourceKind is a union of the 4 canonical labels", () => {
    expectTypeOf<SourceKind>().toEqualTypeOf<"sat" | "pl" | "odoo" | "canonical">();
  });

  it("KpiResult is generic over value type", () => {
    const numeric: KpiResult<number> = {
      value: 7_379_304.29,
      asOfDate: "2026-04-23",
      source: "pl",
      definition: {
        title: "Ingresos del mes",
        description: "Suma del P&L del mes actual.",
        formula: "SUM(gold_pl_statement.total_income) WHERE period = YYYY-MM",
        table: "gold_pl_statement",
      },
      comparison: null,
      sources: undefined,
      drift: null,
    };
    expectTypeOf(numeric.value).toBeNumber();
    expectTypeOf(numeric.source).toEqualTypeOf<SourceKind>();
  });

  it("Comparison carries direction enum", () => {
    expectTypeOf<Comparison["direction"]>().toEqualTypeOf<"up" | "down" | "flat">();
  });

  it("TimeSeries carries a selected range and a full range", () => {
    const series: TimeSeries<number> = {
      points: [{ period: "2026-04", value: 8_314_094, source: "sat" }],
      fullRange: { earliest: "2021-01", latest: "2026-04" },
      selectedRange: { from: "2025-05", to: "2026-04" },
      source: "sat",
    };
    expectTypeOf(series.points).toEqualTypeOf<TimeSeriesPoint<number>[]>();
  });
});
