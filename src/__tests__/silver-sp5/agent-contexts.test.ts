import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FULL_BAN = [
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

describe("agent context modules — no §12 legacy reads", () => {
  for (const f of ["src/lib/agents/director-chat-context.ts", "src/lib/agents/financiero-context.ts"]) {
    it(`${f} clean`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of FULL_BAN) expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    });
    it(`${f} Bronze reads annotated SP5-EXCEPTION`, () => {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      const bronze = /\.from\(['"](odoo_|syntage_)/;
      for (const line of lines) if (bronze.test(line)) expect(line).toContain("SP5-EXCEPTION");
    });
  }
});
