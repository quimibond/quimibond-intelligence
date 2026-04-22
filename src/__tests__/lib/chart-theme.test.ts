import { describe, expect, it } from "vitest";
import { CHART_PALETTE, resolveSeriesColor } from "@/lib/chart-theme";

describe("CHART_PALETTE", () => {
  it("exposes semantic traffic-light keys as CSS var references", () => {
    expect(CHART_PALETTE.positive).toBe("var(--status-ok)");
    expect(CHART_PALETTE.warning).toBe("var(--status-warning)");
    expect(CHART_PALETTE.negative).toBe("var(--status-critical)");
    expect(CHART_PALETTE.neutral).toBe("var(--status-info)");
    expect(CHART_PALETTE.muted).toBe("var(--status-muted)");
  });

  it("exposes 5-stop aging gradient", () => {
    expect(CHART_PALETTE.aging.current).toBe("var(--aging-current)");
    expect(CHART_PALETTE.aging.d1_30).toBe("var(--aging-1-30)");
    expect(CHART_PALETTE.aging.d31_60).toBe("var(--aging-31-60)");
    expect(CHART_PALETTE.aging.d61_90).toBe("var(--aging-61-90)");
    expect(CHART_PALETTE.aging.d90_plus).toBe("var(--aging-90-plus)");
  });

  it("exposes 5 multi-series tokens preserving --chart-1..5", () => {
    expect(CHART_PALETTE.series).toHaveLength(5);
    expect(CHART_PALETTE.series[0]).toBe("var(--chart-1)");
    expect(CHART_PALETTE.series[4]).toBe("var(--chart-5)");
  });
});

describe("resolveSeriesColor", () => {
  it("returns series[0] = var(--chart-1) for index 0", () => {
    expect(resolveSeriesColor(0)).toBe("var(--chart-1)");
  });

  it("returns series[2] = var(--chart-3) for index 2", () => {
    expect(resolveSeriesColor(2)).toBe("var(--chart-3)");
  });

  it("wraps via modulo: index 5 returns series[0]", () => {
    expect(resolveSeriesColor(5)).toBe("var(--chart-1)");
  });

  it("wraps via modulo: index 7 returns series[2]", () => {
    expect(resolveSeriesColor(7)).toBe("var(--chart-3)");
  });

  it("with semantic override 'positive' returns var(--status-ok) regardless of index", () => {
    expect(resolveSeriesColor(3, "positive")).toBe("var(--status-ok)");
    expect(resolveSeriesColor(0, "positive")).toBe("var(--status-ok)");
  });

  it("with semantic override 'negative' returns var(--status-critical)", () => {
    expect(resolveSeriesColor(1, "negative")).toBe("var(--status-critical)");
  });
});
