import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("api/inbox routes — exist and have correct structure", () => {
  const routes = [
    "src/app/api/inbox/top/route.ts",
    "src/app/api/inbox/resolve/route.ts",
    "src/app/api/inbox/assign/route.ts",
    "src/app/api/inbox/action/operationalize/route.ts",
    "src/app/api/inbox/action/link_manual/route.ts",
  ];

  for (const r of routes) {
    it(`${r} exists`, () => expect(existsSync(r)).toBe(true));

    it(`${r} exports expected handler`, () => {
      const src = readFileSync(r, "utf8");
      if (r.includes("/top/")) {
        expect(src).toMatch(/export async function GET/);
      } else {
        expect(src).toMatch(/export async function POST/);
      }
    });

    it(`${r} reads from canonical/gold/evidence only`, () => {
      const src = readFileSync(r, "utf8");
      const banned = [
        "invoices_unified",
        "payments_unified",
        "company_profile",
        "company_narrative",
        "pl_estado_resultados",
        "customer_ltv_health",
        "syntage_invoices_enriched",
        "products_unified",
        "unified_invoices",
        "unified_payment_allocations",
        "invoice_bridge",
        "orders_unified",
        "order_fulfillment_bridge",
        "person_unified",
        "company_profile_sat",
        "monthly_revenue_by_company",
        "monthly_revenue_trend",
        "analytics_customer_360",
        "balance_sheet",
        "revenue_concentration",
        "portfolio_concentration",
        "cash_position",
        "cashflow_current_cash",
        "cashflow_liquidity_metrics",
        "customer_margin_analysis",
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
      ];
      for (const t of banned) {
        expect(src, `should not reference banned table: ${t}`).not.toContain(t);
      }
    });
  }
});

describe("api/inbox routes — no Bronze odoo_* reads", () => {
  const routes = [
    "src/app/api/inbox/top/route.ts",
    "src/app/api/inbox/resolve/route.ts",
    "src/app/api/inbox/assign/route.ts",
    "src/app/api/inbox/action/operationalize/route.ts",
    "src/app/api/inbox/action/link_manual/route.ts",
  ];

  const bronzeTables = [
    "odoo_sale_orders",
    "odoo_purchase_orders",
    "odoo_order_lines",
    "odoo_invoices",
    "odoo_invoice_lines",
    "odoo_account_payments",
    "odoo_deliveries",
    "odoo_manufacturing",
    "odoo_crm_leads",
    "odoo_users",
    "odoo_employees",
    "odoo_departments",
    "odoo_activities",
    "odoo_orderpoints",
    "odoo_products",
    "odoo_payments",
  ];

  for (const r of routes) {
    it(`${r} has no Bronze odoo_* reads`, () => {
      const src = readFileSync(r, "utf8");
      for (const t of bronzeTables) {
        expect(src, `should not reference Bronze table: ${t}`).not.toContain(t);
      }
    });
  }
});
