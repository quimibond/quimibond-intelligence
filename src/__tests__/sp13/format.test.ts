import { describe, it, expect } from "vitest";
import {
  sourceLabel,
  sourceShortLabel,
  computeDelta,
  driftSeverity,
} from "@/lib/kpi/format";

describe("sourceLabel", () => {
  it("maps each source to its Spanish display label", () => {
    expect(sourceLabel("sat")).toBe("SAT (fiscal)");
    expect(sourceLabel("pl")).toBe("P&L contable");
    expect(sourceLabel("odoo")).toBe("Odoo operativo");
    expect(sourceLabel("canonical")).toBe("Canonical");
  });
});

describe("sourceShortLabel", () => {
  it("returns compact labels for badges", () => {
    expect(sourceShortLabel("sat")).toBe("SAT");
    expect(sourceShortLabel("pl")).toBe("P&L");
    expect(sourceShortLabel("odoo")).toBe("Odoo");
    expect(sourceShortLabel("canonical")).toBe("Canon.");
  });
});

describe("computeDelta", () => {
  it("returns up when current > prior", () => {
    const c = computeDelta({ current: 110, prior: 100, label: "vs mes" });
    expect(c).toEqual({
      label: "vs mes",
      priorValue: 100,
      delta: 10,
      deltaPct: 10,
      direction: "up",
    });
  });
  it("returns down when current < prior", () => {
    const c = computeDelta({ current: 90, prior: 100, label: "vs mes" });
    expect(c?.direction).toBe("down");
    expect(c?.deltaPct).toBe(-10);
  });
  it("returns flat when equal", () => {
    const c = computeDelta({ current: 100, prior: 100, label: "vs mes" });
    expect(c?.direction).toBe("flat");
    expect(c?.deltaPct).toBe(0);
  });
  it("returns deltaPct null when prior is 0 (avoid Infinity)", () => {
    const c = computeDelta({ current: 50, prior: 0, label: "vs mes" });
    expect(c?.deltaPct).toBeNull();
    expect(c?.direction).toBe("up");
  });
  it("returns null for null inputs", () => {
    expect(computeDelta({ current: null, prior: 100, label: "vs" })).toBeNull();
    expect(computeDelta({ current: 100, prior: null, label: "vs" })).toBeNull();
  });
});

describe("driftSeverity", () => {
  it("info for diffs under 5%", () => {
    expect(driftSeverity(0.02)).toBe("info");
    expect(driftSeverity(-0.04)).toBe("info");
  });
  it("warning for 5% to 15%", () => {
    expect(driftSeverity(0.1)).toBe("warning");
    expect(driftSeverity(-0.12)).toBe("warning");
  });
  it("critical for over 15%", () => {
    expect(driftSeverity(0.2)).toBe("critical");
    expect(driftSeverity(-0.5)).toBe("critical");
  });
});
