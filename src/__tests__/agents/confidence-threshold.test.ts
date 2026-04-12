import { describe, it, expect } from "vitest";
import { computeAdaptiveThreshold } from "@/lib/agents/confidence-threshold";

describe("computeAdaptiveThreshold", () => {
  it("sin datos suficientes → 0.80", () => {
    expect(computeAdaptiveThreshold({ acted: 1, dismissed: 1, expired: 0, total: 5 })).toBe(0.80);
  });

  it("expired alto (CEO ignora) → soft dismiss sube dismissRate → 0.92", () => {
    // 2 acted, 0 dismissed, 30 expired → effDis=15, decided=17, dismissRate=88% → 0.92
    expect(computeAdaptiveThreshold({ acted: 2, dismissed: 0, expired: 30, total: 32 })).toBe(0.92);
  });

  it("acted_rate alto, sin dismiss ni expired → 0.70", () => {
    // acted=10, effDis=0, decided=10, dismissRate=0%, actedRate=100% → 0.70
    expect(computeAdaptiveThreshold({ acted: 10, dismissed: 0, expired: 0, total: 15 })).toBe(0.70);
  });

  it("dismiss moderado (20-40%) → 0.83", () => {
    // acted=8, dismissed=2, expired=2 → effDis=3, decided=11, dismissRate=27.3% → 0.83
    expect(computeAdaptiveThreshold({ acted: 8, dismissed: 2, expired: 2, total: 15 })).toBe(0.83);
  });
});
