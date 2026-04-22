import { describe, expect, it } from "vitest";
import { CHART_PALETTE } from "@/lib/chart-theme";

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
