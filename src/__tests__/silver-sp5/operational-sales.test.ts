import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/sales.ts — canonical reads", () => {
  it("listSaleOrders returns canonical rows", async () => {
    const mod = await import("@/lib/queries/operational/sales");
    const rows = await mod.listSaleOrders({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_id");
  });

  it("listSaleOrderLines returns canonical rows with order_type=sale", async () => {
    const mod = await import("@/lib/queries/operational/sales");
    const rows = await mod.listSaleOrderLines({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0].order_type).toBe("sale");
    }
  });

  it("listCrmLeads returns canonical rows", async () => {
    const mod = await import("@/lib/queries/operational/sales");
    const rows = await mod.listCrmLeads({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_id");
  });

  it("salesBySalesperson returns aggregated rows", async () => {
    const mod = await import("@/lib/queries/operational/sales");
    const rows = await mod.salesBySalesperson({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("name");
      expect(rows[0]).toHaveProperty("total_amount");
    }
  });

  it("fetchSalespersonMetadata returns internal contacts", async () => {
    const mod = await import("@/lib/queries/operational/sales");
    const rows = await mod.fetchSalespersonMetadata();
    expect(Array.isArray(rows)).toBe(true);
    // All should be internal contacts
    for (const r of rows) {
      expect(r.contact_type).toMatch(/^internal_/);
    }
  });
});

describe("operational/sales.ts — no §12 drop-list legacy reads", () => {
  it("source is clean of every drop-list MV/view", () => {
    const src = readFileSync("src/lib/queries/operational/sales.ts", "utf8");
    const banned = [
      "invoices_unified","payments_unified","syntage_invoices_enriched","products_unified",
      "unified_invoices","unified_payment_allocations","invoice_bridge","orders_unified",
      "order_fulfillment_bridge","person_unified","company_profile","company_profile_sat",
      "monthly_revenue_by_company","monthly_revenue_trend","analytics_customer_360",
      "balance_sheet","pl_estado_resultados","revenue_concentration","portfolio_concentration",
      "cash_position","cashflow_current_cash","cashflow_liquidity_metrics",
      "customer_margin_analysis","customer_ltv_health","customer_product_matrix",
      "supplier_product_matrix","supplier_price_index","supplier_concentration_herfindahl",
      "rfm_segments","customer_cohorts","partner_payment_profile","account_payment_profile",
      "product_margin_analysis","product_price_history","cross_director_signals",
      "company_email_intelligence","company_handlers","company_insight_history","company_narrative",
    ];
    for (const t of banned) expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
  });
  it("Bronze-table reads are either absent or SP5-EXCEPTION-annotated", () => {
    const src = readFileSync("src/lib/queries/operational/sales.ts", "utf8");
    const lines = src.split("\n");
    const bronze = /\.from\(['"](odoo_sale_orders|odoo_order_lines|odoo_crm_leads|odoo_invoices|odoo_payments|syntage_)/;
    for (const line of lines) {
      if (bronze.test(line)) expect(line).toContain("SP5-EXCEPTION");
    }
  });
});
