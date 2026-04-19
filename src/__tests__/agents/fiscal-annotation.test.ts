import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFiscalAnnotation } from "@/lib/agents/fiscal-annotation";

function mockSb(rpcResult: unknown) {
  return {
    rpc: (_name: string, _params: Record<string, unknown>) =>
      Promise.resolve({ data: rpcResult })
  } as unknown as SupabaseClient;
}

describe("applyFiscalAnnotation", () => {
  it("devuelve null cuando company_id es null", async () => {
    const sb = mockSb({ flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 3, detail: "test", issue_ids: ["a","b","c"] });
    const result = await applyFiscalAnnotation(sb, {
      company_id: null,
      agent_slug: "ventas",
      description: "CEO debe revisar CLIENTE X"
    });
    expect(result).toBeNull();
  });

  it("devuelve null cuando RPC retorna null (company sin issues)", async () => {
    const sb = mockSb(null);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "ventas",
      description: "Revisar cliente"
    });
    expect(result).toBeNull();
  });

  it("devuelve annotation cuando company tiene blacklist_69b", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "RFC XAXX010101ABC en 69-B",
      issue_ids: ["u1","u2","u3","u4","u5"] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "ventas",
      description: "Expandir cliente"
    });
    expect(result).toEqual(annot);
  });

  it("salta self-flag cuando agent_slug es compliance", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "test", issue_ids: ["u1"] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "compliance",
      description: "Ya habla de fiscal"
    });
    expect(result).toBeNull();
  });

  it("salta self-flag cuando description ya menciona 69-B", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "test", issue_ids: ["u1"] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "riesgo",
      description: "Proveedor aparece en blacklist 69-B del SAT"
    });
    expect(result).toBeNull();
  });

  it("salta self-flag cuando description menciona complemento", async () => {
    const annot = { flag: "payment_missing_complemento", severity: "high",
      issue_count: 2, detail: "test", issue_ids: ["u1","u2"] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "financiero",
      description: "Falta complemento de pago tipo P"
    });
    expect(result).toBeNull();
  });
});
