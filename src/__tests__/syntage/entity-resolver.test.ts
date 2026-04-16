// src/__tests__/syntage/entity-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveEntity, type EntityMapStore } from "@/lib/syntage/entity-resolver";

function makeStore(rows: { taxpayer_rfc: string; odoo_company_id: number; is_active: boolean }[]): EntityMapStore {
  return {
    async lookup(rfc) {
      const row = rows.find(r => r.taxpayer_rfc.toUpperCase() === rfc.toUpperCase() && r.is_active);
      return row ? { odooCompanyId: row.odoo_company_id } : null;
    },
  };
}

describe("resolveEntity", () => {
  const store = makeStore([
    { taxpayer_rfc: "QIN120315XX1", odoo_company_id: 1, is_active: true },
    { taxpayer_rfc: "QCO170508YY2", odoo_company_id: 2, is_active: true },
    { taxpayer_rfc: "OLD000101ZZ9", odoo_company_id: 3, is_active: false },
  ]);

  it("resolves a known active RFC to its odoo_company_id", async () => {
    expect(await resolveEntity(store, "QIN120315XX1")).toEqual({ odooCompanyId: 1 });
  });

  it("is case-insensitive on RFC", async () => {
    expect(await resolveEntity(store, "qin120315xx1")).toEqual({ odooCompanyId: 1 });
  });

  it("returns null for unmapped RFC", async () => {
    expect(await resolveEntity(store, "UNKNOWN123")).toBeNull();
  });

  it("returns null for inactive mapping", async () => {
    expect(await resolveEntity(store, "OLD000101ZZ9")).toBeNull();
  });
});
