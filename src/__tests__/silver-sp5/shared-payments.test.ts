import { describe, it, expect, beforeAll } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("_shared/payments.ts — canonical reads", () => {
  let listCompanyPayments: (
    canonical_company_id: number,
    opts?: { limit?: number },
  ) => Promise<unknown[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/payments");
    listCompanyPayments = mod.listCompanyPayments as typeof listCompanyPayments;
    if (!listCompanyPayments) throw new Error("listCompanyPayments export missing");
  });

  it("listCompanyPayments returns canonical_payments rows", async () => {
    // Company id=868 is Quimibond self — may have 0 outbound payments.
    // Try a few known customer canonical_company_ids if 868 returns empty.
    const rows = await listCompanyPayments(868, { limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty("canonical_id");
      expect(row).toHaveProperty("amount_mxn_resolved");
      expect(row).toHaveProperty("payment_date_resolved");
    }
  });
});

describe("_shared/payments.ts — source has no banned legacy reads", () => {
  it("payments.ts legacy table bans", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/lib/queries/_shared/payments.ts",
      "utf8",
    );
    for (const token of [
      "from('odoo_account_payments",
      'from("odoo_account_payments',
      "from('payments_unified",
      'from("payments_unified',
      "from('unified_payment_allocations",
      'from("unified_payment_allocations',
    ]) {
      expect(src, `should not contain: ${token}`).not.toContain(token);
    }
  });
});
