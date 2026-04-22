import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("analytics/finance.ts — canonical/gold reads", () => {
  let getCashPosition: () => Promise<unknown[]>;
  let getPlHistory: (opts?: { from?: string; to?: string }) => Promise<unknown[]>;
  let getWorkingCapital: () => Promise<unknown>;
  let getArZombies: () => Promise<{ count: number; totalMxn: number }>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/analytics/finance");
    getCashPosition = mod.getCashPosition;
    getPlHistory = mod.getPlHistory;
    getWorkingCapital = mod.getWorkingCapital;
    getArZombies = mod.getArZombies;
  });

  it("getCashPosition returns array from canonical_bank_balances", async () => {
    const rows = await getCashPosition();
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.saldoMxn).toBe("number");
      expect(typeof r.saldo).toBe("number");
    }
  });

  it("getPlHistory returns rows from gold_pl_statement", async () => {
    const rows = await getPlHistory(3);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.period).toBe("string");
      expect(typeof r.ingresos).toBe("number");
      expect(r.ingresos).toBeGreaterThanOrEqual(0);
    }
  });

  it("getWorkingCapital returns gold_cashflow-derived shape", async () => {
    const wc = await getWorkingCapital();
    expect(wc).toBeTruthy();
    if (wc) {
      expect(typeof wc.capitalDeTrabajo).toBe("number");
      expect(typeof wc.efectivoDisponible).toBe("number");
    }
  });

  it("getArZombies returns non-negative totals from canonical_invoices", async () => {
    const result = await getArZombies();
    expect(result).toBeTruthy();
    expect(typeof result.count).toBe("number");
    expect(typeof result.totalMxn).toBe("number");
    expect(result.count).toBeGreaterThanOrEqual(0);
    expect(result.totalMxn).toBeGreaterThanOrEqual(0);
  });
});

describe("analytics/finance.ts — source has no banned legacy reads", () => {
  it("finance.ts legacy table bans", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    const banned = [
      "from('invoices_unified",
      'from("invoices_unified',
      "from('pl_estado_resultados",
      'from("pl_estado_resultados',
      "from('working_capital'",
      'from("working_capital"',
      // working_capital_cycle is SP5-VERIFIED KEEP (gold_cashflow has no DSO/DPO/DIO fields)
      "from('cash_position",
      'from("cash_position',
      "from('partner_payment_profile",
      'from("partner_payment_profile',
      "from('account_payment_profile",
      'from("account_payment_profile',
      "from('monthly_revenue_by_company",
      'from("monthly_revenue_by_company',
      "from('monthly_revenue_trend",
      'from("monthly_revenue_trend',
      "from('balance_sheet",
      'from("balance_sheet',
    ];
    for (const token of banned) {
      expect(src, `Found banned token: ${token}`).not.toContain(token);
    }
  });

  it("finance.ts uses canonical_invoices not invoices_unified for AR", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    expect(src).toContain("canonical_invoices");
  });

  it("finance.ts uses canonical_bank_balances not cash_position", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    expect(src).toContain("canonical_bank_balances");
  });

  it("finance.ts uses gold_pl_statement not pl_estado_resultados", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    expect(src).toContain("gold_pl_statement");
  });

  it("finance.ts uses gold_cashflow not working_capital view", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    expect(src).toContain("gold_cashflow");
  });

  it("finance.ts has SP5-VERIFIED annotations on retained objects", () => {
    const src = readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    const count = (src.match(/SP5-VERIFIED/g) ?? []).length;
    // Expect at least 5: cfo_dashboard, projected_cash_flow_weekly, get_projected_cash_flow_summary,
    // get_cashflow_recommendations, journal_flow_profile, working_capital_cycle
    expect(count).toBeGreaterThanOrEqual(5);
  });
});
