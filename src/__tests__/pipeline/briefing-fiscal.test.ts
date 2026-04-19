import { describe, it, expect } from "vitest";
import {
  buildFiscalOneLiner,
  shouldIncludeFiscalSection
} from "@/app/api/pipeline/briefing/fiscal-helpers";

describe("buildFiscalOneLiner", () => {
  it("formato estándar cuando hay snapshots today y yesterday", () => {
    const today = { total_open: 27140, severity_counts: { critical: 9985, high: 5552, medium: 11603, low: 0 } };
    const yesterday = { total_open: 27185, severity_counts: { critical: 10030, high: 5552, medium: 11603, low: 0 } };
    const line = buildFiscalOneLiner(today, yesterday);
    expect(line).toContain("27140");
    expect(line).toContain("crítico 9985");
    expect(line).toContain("Δ 24h: -45");
  });

  it("fallback cuando no hay snapshot de ayer", () => {
    const today = { total_open: 100, severity_counts: { critical: 10, high: 5, medium: 85, low: 0 } };
    const line = buildFiscalOneLiner(today, null);
    expect(line).toContain("primer snapshot");
  });

  it("fallback cuando snapshot today no existe", () => {
    const line = buildFiscalOneLiner(null, null);
    expect(line).toContain("pipeline degradado");
  });
});

describe("shouldIncludeFiscalSection", () => {
  const base = { new_critical_24h: 0, blacklist_new_24h: 0, cancelled_but_posted_new_24h: 0, tax_status_changed: false };
  it("incluye sección si hay critical nuevo", () => {
    expect(shouldIncludeFiscalSection({ ...base, new_critical_24h: 3 })).toBe(true);
  });
  it("incluye sección si blacklist 69-B agregó", () => {
    expect(shouldIncludeFiscalSection({ ...base, blacklist_new_24h: 1 })).toBe(true);
  });
  it("incluye sección si cancelled_but_posted nuevo", () => {
    expect(shouldIncludeFiscalSection({ ...base, cancelled_but_posted_new_24h: 1 })).toBe(true);
  });
  it("incluye sección si tax_status cambió", () => {
    expect(shouldIncludeFiscalSection({ ...base, tax_status_changed: true })).toBe(true);
  });
  it("omite sección en día tranquilo", () => {
    expect(shouldIncludeFiscalSection(base)).toBe(false);
  });
});
