import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

const SRC = path.resolve(__dirname, "../../lib/queries/analytics");

describeIntegration("analytics/ small files — canonical/gold reads", () => {
  it("customer-360 exports fetchCustomer360", async () => {
    const mod = await import("@/lib/queries/analytics/customer-360");
    const fn = mod.fetchCustomer360 ?? mod.getCustomer360;
    expect(fn).toBeTruthy();
    const row = await fn!(868);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty("canonical_company_id");
  });
});

describe("analytics/ small files — source has no banned legacy reads", () => {
  it("pnl.ts reads gold_pl_statement and has no legacy reads", () => {
    const src = readFileSync(path.join(SRC, "pnl.ts"), "utf8");
    expect(src).toContain("gold_pl_statement");
    expect(src).not.toContain("from('pl_estado_resultados");
    expect(src).not.toContain('from("pl_estado_resultados');
  });

  it("dashboard.ts has no banned reads", () => {
    const src = readFileSync(path.join(SRC, "dashboard.ts"), "utf8");
    for (const token of [
      "company_profile",
      "analytics_customer_360",
      "monthly_revenue_by_company",
      "monthly_revenue_trend",
      "balance_sheet",
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${token}['"]`));
    }
  });

  it("dashboard.ts reads gold_reconciliation_health, gold_cashflow, gold_revenue_monthly, gold_ceo_inbox", () => {
    const src = readFileSync(path.join(SRC, "dashboard.ts"), "utf8");
    expect(src).toContain("gold_reconciliation_health");
    expect(src).toContain("gold_cashflow");
    expect(src).toContain("gold_revenue_monthly");
    expect(src).toContain("gold_ceo_inbox");
  });

  it("customer-360.ts has no banned reads", () => {
    const src = readFileSync(path.join(SRC, "customer-360.ts"), "utf8");
    for (const token of [
      "company_profile",
      "company_profile_sat",
      "analytics_customer_360",
      "customer_ltv_health",
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${token}['"]`));
    }
  });

  it("customer-360.ts reads gold_company_360", () => {
    const src = readFileSync(path.join(SRC, "customer-360.ts"), "utf8");
    expect(src).toContain("gold_company_360");
  });

  it("currency-rates.ts reads canonical_fx_rates or odoo_currency_rates (Bronze-allowed for FX)", () => {
    const src = readFileSync(path.join(SRC, "currency-rates.ts"), "utf8");
    const ok =
      src.includes("canonical_fx_rates") || src.includes("odoo_currency_rates");
    expect(ok).toBe(true);
    // If Bronze read, must have SP5-VERIFIED annotation
    if (src.match(/from\(['"]odoo_currency_rates/)) {
      expect(src).toContain("SP5-VERIFIED");
    }
  });

  it("analytics/index.ts has no banned legacy re-exports", () => {
    const src = readFileSync(path.join(SRC, "index.ts"), "utf8");
    for (const token of [
      "company_profile",
      "analytics_customer_360",
      "monthly_revenue_by_company",
      "monthly_revenue_trend",
      "partner_payment_profile",
      "account_payment_profile",
      "invoices_unified",
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${token}['"]`));
    }
  });

  it("analytics/index.ts does not read from supplier_price_index", () => {
    const src = readFileSync(path.join(SRC, "index.ts"), "utf8");
    expect(src).not.toMatch(/\.from\(['"]supplier_price_index['"]\)/);
  });

  it("analytics/index.ts barrel re-exports customer-360, dashboard, pnl, currency-rates", () => {
    const src = readFileSync(path.join(SRC, "index.ts"), "utf8");
    expect(src).toContain('from "./customer-360"');
    expect(src).toContain('from "./dashboard"');
    expect(src).toContain('from "./pnl"');
    expect(src).toContain('from "./currency-rates"');
  });
});
