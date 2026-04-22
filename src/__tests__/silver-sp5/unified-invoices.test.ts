/**
 * SP5 Task 11 — unified/ folder canonical rewire tests
 *
 * Ban tests run without env (static source check).
 * Integration tests require NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

const FULL_BAN = [
  "invoices_unified",
  "payments_unified",
  "syntage_invoices_enriched",
  "products_unified",
  "unified_invoices",
  "unified_payment_allocations",
  "invoice_bridge",
  "orders_unified",
  "order_fulfillment_bridge",
  "person_unified",
  "company_profile",
  "company_profile_sat",
  "monthly_revenue_by_company",
  "monthly_revenue_trend",
  "analytics_customer_360",
  "balance_sheet",
  "pl_estado_resultados",
  "revenue_concentration",
  "portfolio_concentration",
  "cash_position",
  "cashflow_current_cash",
  "cashflow_liquidity_metrics",
  "customer_margin_analysis",
  "customer_ltv_health",
  "customer_product_matrix",
  "supplier_product_matrix",
  "supplier_price_index",
  "supplier_concentration_herfindahl",
  "rfm_segments",
  "customer_cohorts",
  "partner_payment_profile",
  "account_payment_profile",
  "product_margin_analysis",
  "product_price_history",
  "cross_director_signals",
  "company_email_intelligence",
  "company_handlers",
  "company_insight_history",
  "company_narrative",
];

const FILES = [
  "src/lib/queries/unified/invoices.ts",
  "src/lib/queries/unified/invoice-detail.ts",
  "src/lib/queries/unified/index.ts",
];

describeIntegration("unified/ — canonical reads", () => {
  it("listInvoices returns canonical_invoices rows", async () => {
    const mod = await import("@/lib/queries/unified/invoices");
    const rows = await mod.listInvoices({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0]).toHaveProperty("direction");
    }
  });

  it("fetchInvoiceDetail returns invoice with allocations array", async () => {
    const invMod = await import("@/lib/queries/unified/invoices");
    const detMod = await import("@/lib/queries/unified/invoice-detail");
    const list = await invMod.listInvoices({ limit: 1 });
    if (list.length > 0) {
      const det = await detMod.fetchInvoiceDetail(list[0].canonical_id);
      expect(det).toBeTruthy();
      expect(Array.isArray(det!.allocations)).toBe(true);
    }
  });

  it("listAllocations returns array", async () => {
    const mod = await import("@/lib/queries/unified/invoices");
    const result = await mod.listAllocations("nonexistent-id");
    expect(Array.isArray(result)).toBe(true);
  });

  it("invoicesReceivableAging returns bucket object", async () => {
    const mod = await import("@/lib/queries/unified/invoices");
    const buckets = await mod.invoicesReceivableAging();
    expect(buckets).toHaveProperty("current");
    expect(buckets).toHaveProperty("1-30");
    expect(buckets).toHaveProperty("90+");
  });
});

describe("unified/ — no §12 legacy reads", () => {
  for (const f of FILES) {
    it(`${f} clean of §12 drop-list reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of FULL_BAN) {
        expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
      }
    });
  }

  it("odoo_invoice_lines reads SP5-EXCEPTION-annotated (invoice-detail only)", () => {
    const src = readFileSync(
      "src/lib/queries/unified/invoice-detail.ts",
      "utf8"
    );
    const lines = src.split("\n");
    for (const line of lines) {
      if (/\.from\(['"]odoo_invoice_lines/.test(line)) {
        expect(line).toContain("SP5-EXCEPTION");
      }
    }
  });
});
