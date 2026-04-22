import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/purchases.ts — canonical reads", () => {
  it("listPurchaseOrders reads canonical_purchase_orders", async () => {
    const mod = await import("@/lib/queries/operational/purchases");
    const rows = await mod.listPurchaseOrders({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_id");
  });

  it("listPurchaseOrderLines reads canonical_order_lines order_type=purchase", async () => {
    const mod = await import("@/lib/queries/operational/purchases");
    const rows = await mod.listPurchaseOrderLines({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0].order_type).toBe("purchase");
    }
  });

  it("listVendorPayments reads canonical_payments direction=sent", async () => {
    const mod = await import("@/lib/queries/operational/purchases");
    const rows = await mod.listVendorPayments({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0].direction).toBe("sent");
    }
  });

  it("listSupplierPayments is alias of listVendorPayments", async () => {
    const mod = await import("@/lib/queries/operational/purchases");
    expect(mod.listSupplierPayments).toBe(mod.listVendorPayments);
  });
});

describe("operational/purchases.ts — no §12 drop-list legacy reads", () => {
  it("source clean of all drop-list MVs/views", () => {
    const src = readFileSync("src/lib/queries/operational/purchases.ts", "utf8");
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

  it("Bronze reads absent or SP5-EXCEPTION annotated", () => {
    const src = readFileSync("src/lib/queries/operational/purchases.ts", "utf8");
    const lines = src.split("\n");
    const bronze = /\.from\(['"](odoo_purchase_orders|odoo_order_lines|odoo_account_payments|odoo_payments|odoo_invoices|odoo_users|odoo_products|syntage_)/;
    for (const line of lines) {
      if (bronze.test(line)) expect(line).toContain("SP5-EXCEPTION");
    }
  });
});
