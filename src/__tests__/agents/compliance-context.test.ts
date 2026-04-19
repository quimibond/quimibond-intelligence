import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildComplianceContextOperativo } from "@/lib/agents/compliance-context";

// Factory para un mock de Supabase con thenable chainable.
// Cada tabla retorna un array de fixtures según el key `fixtures`.
function makeSbMock(fixtures: Record<string, unknown>) {
  const makeChain = (table: string) => {
    const thenable = Promise.resolve({ data: fixtures[table] ?? [] });
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") return thenable.then.bind(thenable);
        return () => new Proxy({}, handler);
      }
    };
    return new Proxy({}, handler);
  };
  return {
    from: (table: string) => makeChain(table),
    rpc: (name: string) => Promise.resolve({ data: fixtures[`rpc:${name}`] ?? null })
  } as unknown as SupabaseClient;
}

describe("buildComplianceContextOperativo", () => {
  it("retorna string con secciones clave cuando hay data", async () => {
    const sb = makeSbMock({
      reconciliation_issues: [
        {
          issue_id: "uuid-1",
          issue_type: "sat_only_cfdi_issued",
          severity: "critical",
          description: "CFDI 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d sin Odoo",
          company_id: null,
          detected_at: "2026-04-18"
        }
      ],
      syntage_tax_status: [
        { opinion_cumplimiento: "positiva", fecha_consulta: "2026-04-19" }
      ],
      "rpc:get_syntage_reconciliation_summary": {
        by_severity: { critical: 9985, high: 6582, medium: 10950, low: 124 },
        by_type: [{ type: "sat_only_cfdi_issued", open: 9985 }]
      }
    });
    const out = await buildComplianceContextOperativo(sb, "## PROFILE\nQuimibond SA\n");
    expect(out).toContain("MODO: OPERATIVO");
    expect(out).toContain("RESUMEN FISCAL");
    expect(out).toContain("9985");
    expect(out).toContain("positiva");
  });

  it("no revienta si Layer 3 está vacío", async () => {
    const sb = makeSbMock({});
    const out = await buildComplianceContextOperativo(sb, "## PROFILE\n");
    expect(out).toContain("MODO: OPERATIVO");
    expect(out).toContain("Sin issues abiertos");
  });
});

describe("buildComplianceContextEstrategico", () => {
  it("incluye trend semanal + cobertura validación + declaraciones + resoluciones", async () => {
    const { buildComplianceContextEstrategico } =
      await import("@/lib/agents/compliance-context");
    // Reuse makeSbMock from outer scope if defined there, else redefine.
    const sb = {
      from: () => ({} as never),
      rpc: (name: string) => {
        const fixtures: Record<string, unknown> = {
          syntage_open_issues_by_week: [{ week: "2026-W15", severity: "critical", cnt: 9985 }],
          syntage_top_unlinked_rfcs: [{ rfc: "XAXX010101ABC", cnt: 100, last_seen: "2026-04-01" }],
          syntage_validation_coverage_by_month: [{ month: "2026-03", posted: 1200, validated: 1170, ratio: 0.975 }],
          syntage_recent_resolutions: [{ resolution: "historical_pre_odoo", cnt: 100 }],
        };
        return Promise.resolve({ data: fixtures[name] ?? null });
      }
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const out = await buildComplianceContextEstrategico(sb, "## PROFILE\n");
    expect(out).toContain("MODO: ESTRATÉGICO");
    expect(out).toContain("TREND");
    expect(out).toContain("COBERTURA");
    expect(out).toContain("DECLARACIONES");
    expect(out).toContain("RESOLUCIONES");
  });
});
