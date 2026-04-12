import { describe, it, expect, vi } from "vitest";
import { loadDirectorConfig, DEFAULT_DIRECTOR_CONFIG } from "@/lib/agents/director-config";

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
