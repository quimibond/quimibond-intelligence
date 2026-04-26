import { describe, expect, it } from "vitest";
import {
  normalizeRisk,
  bucketOrFilters,
} from "@/lib/queries/sp13/cobranza/ar-by-company";

describe("ar-by-company normalizeRisk", () => {
  it("maps Spanish + English variants regardless of case", () => {
    expect(normalizeRisk("CRITICA: muy alto riesgo")).toBe("critical");
    expect(normalizeRisk("Critical")).toBe("critical");
    expect(normalizeRisk("Anormal: subiendo")).toBe("abnormal");
    expect(normalizeRisk("ABNORMAL")).toBe("abnormal");
    expect(normalizeRisk("Vigilancia: nuevo cliente")).toBe("watch");
    expect(normalizeRisk("watch")).toBe("watch");
    expect(normalizeRisk("NORMAL: dentro de patron")).toBe("normal");
  });

  it("returns null for empty / unknown inputs", () => {
    expect(normalizeRisk(null)).toBeNull();
    expect(normalizeRisk(undefined)).toBeNull();
    expect(normalizeRisk("")).toBeNull();
    expect(normalizeRisk("UNKNOWN_LABEL")).toBeNull();
  });
});

describe("bucketOrFilters", () => {
  it("returns empty array when no buckets requested", () => {
    expect(bucketOrFilters([])).toEqual([]);
  });

  it("maps each bucket key to the matching cash_flow_aging column", () => {
    expect(bucketOrFilters(["1-30"])).toEqual(["overdue_1_30.gt.0"]);
    expect(bucketOrFilters(["31-60"])).toEqual(["overdue_31_60.gt.0"]);
    expect(bucketOrFilters(["61-90"])).toEqual(["overdue_61_90.gt.0"]);
    expect(bucketOrFilters(["90+"])).toEqual(["overdue_90plus.gt.0"]);
  });

  it("preserves declaration order for multi-bucket selection", () => {
    expect(bucketOrFilters(["31-60", "1-30", "90+"])).toEqual([
      "overdue_1_30.gt.0",
      "overdue_31_60.gt.0",
      "overdue_90plus.gt.0",
    ]);
  });

  it("ignores unknown bucket keys", () => {
    expect(bucketOrFilters(["1-30", "bogus", "future"])).toEqual([
      "overdue_1_30.gt.0",
    ]);
  });

  it("returns a 4-fragment array when all buckets selected — joined as PostgREST .or()", () => {
    const fragments = bucketOrFilters(["1-30", "31-60", "61-90", "90+"]);
    expect(fragments).toHaveLength(4);
    // Caller joins with comma to produce: overdue_1_30.gt.0,overdue_31_60.gt.0,...
    expect(fragments.join(",")).toContain("overdue_1_30.gt.0");
    expect(fragments.join(",")).toContain("overdue_90plus.gt.0");
  });
});
