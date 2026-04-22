/**
 * SP5 Task 10 — operational/operations.ts + operational/team.ts
 *
 * Static tests (always run):
 *   - §12 full ban: no legacy dropped views/MVs
 *   - Bronze-reads must carry SP5-EXCEPTION annotation
 *
 * Integration tests (require NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY):
 *   - listDeliveries reads canonical_deliveries
 *   - listManufacturingOrders reads canonical_manufacturing
 *   - listInventory reads canonical_inventory
 *   - listTeamMembers reads canonical_employees
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const OPS_PATH = path.resolve(
  __dirname,
  "../../lib/queries/operational/operations.ts"
);
const TEAM_PATH = path.resolve(
  __dirname,
  "../../lib/queries/operational/team.ts"
);

// ──────────────────────────────────────────────────────────────────────────
// Integration tests
// ──────────────────────────────────────────────────────────────────────────

describeIntegration("operational/operations.ts — integration", () => {
  it("listDeliveries reads canonical_deliveries and returns an array", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listDeliveries({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("listManufacturingOrders reads canonical_manufacturing and returns an array", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listManufacturingOrders({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("listInventory reads canonical_inventory and returns an array", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listInventory({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("fetchInventoryVelocity reads inventory_velocity MV", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.fetchInventoryVelocity(5);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("fetchDeadStockAnalysis reads dead_stock_analysis MV", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.fetchDeadStockAnalysis(5);
    expect(Array.isArray(rows)).toBe(true);
  });
});

describeIntegration("operational/team.ts — integration", () => {
  it("listTeamMembers reads canonical_employees / canonical_contacts and returns an array", async () => {
    const mod = await import("@/lib/queries/operational/team");
    const rows = await mod.listTeamMembers({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) expect(rows[0]).toHaveProperty("display_name");
  });

  it("listDepartments returns an array with name field", async () => {
    const mod = await import("@/lib/queries/operational/team");
    const rows = await mod.listDepartments();
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) expect(rows[0]).toHaveProperty("name");
  });

  it("fetchEmployeeWorkload returns an array", async () => {
    const mod = await import("@/lib/queries/operational/team");
    const rows = await mod.fetchEmployeeWorkload({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("contact_id");
      expect(rows[0]).toHaveProperty("display_name");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Static ban tests
// ──────────────────────────────────────────────────────────────────────────

describe("operational/operations.ts — no §12 legacy reads", () => {
  it("source has no §12 drop-list reads", () => {
    const src = readFileSync(OPS_PATH, "utf8");
    for (const t of FULL_BAN) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    }
  });

  it("Bronze reads annotated SP5-EXCEPTION", () => {
    const src = readFileSync(OPS_PATH, "utf8");
    const lines = src.split("\n");
    const bronze =
      /\.from\(['"](odoo_deliveries|odoo_manufacturing|odoo_orderpoints|odoo_products|odoo_activities|syntage_)/;
    for (const line of lines) {
      if (bronze.test(line)) {
        expect(line).toContain("SP5-EXCEPTION");
      }
    }
  });
});

describe("operational/team.ts — no §12 legacy reads", () => {
  it("source has no §12 drop-list reads", () => {
    const src = readFileSync(TEAM_PATH, "utf8");
    for (const t of FULL_BAN) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    }
  });

  it("Bronze reads annotated SP5-EXCEPTION", () => {
    const src = readFileSync(TEAM_PATH, "utf8");
    const lines = src.split("\n");
    const bronze =
      /\.from\(['"](odoo_users|odoo_employees|odoo_departments|person_unified|syntage_)/;
    for (const line of lines) {
      if (bronze.test(line)) {
        expect(line).toContain("SP5-EXCEPTION");
      }
    }
  });
});
