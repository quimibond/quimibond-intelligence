import { describe, it, expect, vi } from "vitest";
import { loadDirectorConfig, DEFAULT_DIRECTOR_CONFIG, filterInsightsByConfig } from "@/lib/agents/director-config";

function mockSupabase(configRow: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: configRow, error: null }),
        }),
      }),
    }),
  };
}

describe("loadDirectorConfig", () => {
  it("devuelve defaults cuando config es {}", async () => {
    const sb = mockSupabase({ config: {} });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg).toEqual(DEFAULT_DIRECTOR_CONFIG);
  });

  it("merge con defaults: override solo de campos presentes", async () => {
    const sb = mockSupabase({ config: { min_business_impact_mxn: 50000, max_insights_per_run: 2 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.min_business_impact_mxn).toBe(50000);
    expect(cfg.max_insights_per_run).toBe(2);
    expect(cfg.mode_rotation).toEqual(DEFAULT_DIRECTOR_CONFIG.mode_rotation);
  });

  it("si no hay fila, devuelve defaults", async () => {
    const sb = mockSupabase(null);
    const cfg = await loadDirectorConfig(sb as never, 999);
    expect(cfg).toEqual(DEFAULT_DIRECTOR_CONFIG);
  });

  it("valida tipos: rechaza max_insights > 10 (clamp a 10)", async () => {
    const sb = mockSupabase({ config: { max_insights_per_run: 99 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.max_insights_per_run).toBe(10);
  });

  it("valida tipos: min_business_impact < 0 → 0", async () => {
    const sb = mockSupabase({ config: { min_business_impact_mxn: -500 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.min_business_impact_mxn).toBe(0);
  });
});

describe("filterInsightsByConfig", () => {
  const baseInsight = (overrides: Record<string, unknown>) => ({
    title: "x", description: "x", severity: "medium", confidence: 0.9,
    business_impact_estimate: 100_000, category: "cobranza", ...overrides,
  });

  it("deja pasar todo con config default", () => {
    const ins = [baseInsight({}), baseInsight({ business_impact_estimate: 0 })];
    const out = filterInsightsByConfig(ins, DEFAULT_DIRECTOR_CONFIG);
    expect(out).toHaveLength(2);
  });

  it("descarta insights bajo min_business_impact_mxn", () => {
    const ins = [
      baseInsight({ business_impact_estimate: 10_000 }),
      baseInsight({ business_impact_estimate: 100_000 }),
      baseInsight({ business_impact_estimate: null }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_business_impact_mxn: 50_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].business_impact_estimate).toBe(100_000);
  });

  it("excepción: severity='critical' pasa aunque no tenga impacto", () => {
    const ins = [baseInsight({ severity: "critical", business_impact_estimate: null })];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_business_impact_mxn: 50_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
  });

  it("aplica max_insights_per_run (ordena por impacto desc)", () => {
    const ins = [
      baseInsight({ business_impact_estimate: 10_000, title: "a" }),
      baseInsight({ business_impact_estimate: 500_000, title: "b" }),
      baseInsight({ business_impact_estimate: 100_000, title: "c" }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, max_insights_per_run: 2 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(2);
    expect(out.map(i => i.title)).toEqual(["b", "c"]);
  });

  it("aplica min_confidence_floor", () => {
    const ins = [
      baseInsight({ confidence: 0.82 }),
      baseInsight({ confidence: 0.90 }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_confidence_floor: 0.88 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.90);
  });

  it("descarta insights arriba del max_business_impact_mxn (anti-hallucination cap)", () => {
    const ins = [
      baseInsight({ title: "real", business_impact_estimate: 300_000 }),
      baseInsight({ title: "inflado", business_impact_estimate: 5_800_000 }),
      baseInsight({ title: "null-pass", business_impact_estimate: null }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, max_business_impact_mxn: 500_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out.map(i => i.title)).toEqual(["real", "null-pass"]);
  });

  it("max_business_impact_mxn no se deja rescatar por severity=critical", () => {
    const ins = [
      baseInsight({ title: "fake_critical", severity: "critical", business_impact_estimate: 60_000_000 }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, max_business_impact_mxn: 500_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(0);
  });
});
