import { describe, expect, it } from "vitest";
import {
  scoreInvoice,
  normalizeRisk,
  RISK_WEIGHT,
  UNKNOWN_RISK_WEIGHT,
} from "@/lib/queries/sp13/cobranza/action-list";

describe("normalizeRisk", () => {
  it("maps known Spanish + English variants regardless of case", () => {
    expect(normalizeRisk("CRITICAL")).toBe("critical");
    expect(normalizeRisk("CRITICA: muy alto riesgo")).toBe("critical");
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
    expect(normalizeRisk("???")).toBeNull();
    expect(normalizeRisk("PENDING_CLASSIFICATION")).toBeNull();
  });
});

describe("scoreInvoice", () => {
  it("returns 0 when amount is non-positive", () => {
    expect(
      scoreInvoice({ amount: 0, daysOverdue: 30, risk: "critical" }),
    ).toBe(0);
    expect(
      scoreInvoice({ amount: -100, daysOverdue: 30, risk: "critical" }),
    ).toBe(0);
  });

  it("returns 0 when daysOverdue is non-positive (not yet due)", () => {
    expect(
      scoreInvoice({ amount: 100_000, daysOverdue: 0, risk: "critical" }),
    ).toBe(0);
    expect(
      scoreInvoice({ amount: 100_000, daysOverdue: -5, risk: "critical" }),
    ).toBe(0);
  });

  it("uses risk weight from RISK_WEIGHT table", () => {
    const amt = 100_000;
    const days = 30;
    const factor = Math.log1p(days);
    expect(scoreInvoice({ amount: amt, daysOverdue: days, risk: "critical" }))
      .toBeCloseTo(amt * RISK_WEIGHT.critical * factor);
    expect(scoreInvoice({ amount: amt, daysOverdue: days, risk: "abnormal" }))
      .toBeCloseTo(amt * RISK_WEIGHT.abnormal * factor);
    expect(scoreInvoice({ amount: amt, daysOverdue: days, risk: "watch" }))
      .toBeCloseTo(amt * RISK_WEIGHT.watch * factor);
    expect(scoreInvoice({ amount: amt, daysOverdue: days, risk: "normal" }))
      .toBeCloseTo(amt * RISK_WEIGHT.normal * factor);
  });

  it("falls back to UNKNOWN_RISK_WEIGHT when risk is null", () => {
    const amt = 100_000;
    const days = 30;
    const factor = Math.log1p(days);
    expect(scoreInvoice({ amount: amt, daysOverdue: days, risk: null }))
      .toBeCloseTo(amt * UNKNOWN_RISK_WEIGHT * factor);
  });

  it("ranks critical > abnormal > watch > normal at same amount + days", () => {
    const args = { amount: 50_000, daysOverdue: 60 };
    const sCritical = scoreInvoice({ ...args, risk: "critical" });
    const sAbnormal = scoreInvoice({ ...args, risk: "abnormal" });
    const sWatch = scoreInvoice({ ...args, risk: "watch" });
    const sNormal = scoreInvoice({ ...args, risk: "normal" });
    expect(sCritical).toBeGreaterThan(sAbnormal);
    expect(sAbnormal).toBeGreaterThan(sWatch);
    expect(sWatch).toBeGreaterThan(sNormal);
  });

  it("compresses long-tail via log1p (90d ≈ 1.5× of 30d, not 3×)", () => {
    const args = { amount: 100_000, risk: "critical" as const };
    const s30 = scoreInvoice({ ...args, daysOverdue: 30 });
    const s90 = scoreInvoice({ ...args, daysOverdue: 90 });
    const ratio = s90 / s30;
    // log1p(90)/log1p(30) ≈ 4.51/3.43 ≈ 1.31 — log compression, not linear 3×
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
  });

  it("a $1M abnormal at 30d outranks a $200k critical at 30d (amount dominates)", () => {
    const big = scoreInvoice({
      amount: 1_000_000,
      daysOverdue: 30,
      risk: "abnormal",
    });
    const small = scoreInvoice({
      amount: 200_000,
      daysOverdue: 30,
      risk: "critical",
    });
    expect(big).toBeGreaterThan(small);
  });
});
