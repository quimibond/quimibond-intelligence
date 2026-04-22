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

describeIntegration("intelligence/inbox.ts — live DB", () => {
  it("listInbox returns ≤50 rows with required fields", async () => {
    const mod = await import("@/lib/queries/intelligence/inbox");
    const rows = await mod.listInbox({ limit: 50 });
    expect(rows.length).toBeLessThanOrEqual(50);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("issue_id");
      expect(rows[0]).toHaveProperty("severity");
      expect(rows[0]).toHaveProperty("priority_score");
    }
  });

  it("fetchInboxItem attaches evidence arrays", async () => {
    const mod = await import("@/lib/queries/intelligence/inbox");
    const [first] = await mod.listInbox({ limit: 1 });
    if (first && first.issue_id) {
      const item = await mod.fetchInboxItem(first.issue_id);
      expect(item).toBeTruthy();
      expect(Array.isArray(item!.email_signals)).toBe(true);
      expect(Array.isArray(item!.ai_extracted_facts)).toBe(true);
      expect(Array.isArray(item!.manual_notes)).toBe(true);
      expect(Array.isArray(item!.attachments)).toBe(true);
    }
  });

  it("listInbox severity filter narrows results", async () => {
    const mod = await import("@/lib/queries/intelligence/inbox");
    const rows = await mod.listInbox({ limit: 10, severity: "critical" });
    for (const row of rows) {
      expect(row.severity).toBe("critical");
    }
  });
});

describe("inbox pages + intelligence/inbox — no §12 legacy reads", () => {
  const files = [
    "src/lib/queries/intelligence/inbox.ts",
    "src/app/inbox/page.tsx",
    "src/app/inbox/insight/[id]/page.tsx",
  ];

  for (const f of files) {
    it(`${f} — clean of §12 drop-list reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of FULL_BAN) {
        expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
      }
    });
  }

  it("inbox page imports listInbox from intelligence/inbox", () => {
    const src = readFileSync("src/app/inbox/page.tsx", "utf8");
    expect(src).toMatch(/listInbox|fetchInbox|intelligence\/inbox/);
    expect(src).not.toContain("from('reconciliation_issues");
    expect(src).not.toContain('from("reconciliation_issues');
  });

  it("inbox detail page imports fetchInboxItem from intelligence/inbox", () => {
    const src = readFileSync("src/app/inbox/insight/[id]/page.tsx", "utf8");
    expect(src).toMatch(/fetchInboxItem|intelligence\/inbox/);
    expect(src).not.toContain("from('reconciliation_issues");
    expect(src).not.toContain('from("reconciliation_issues');
  });

  it("actions.ts reads only agent_insights (base table, not banned)", () => {
    const src = readFileSync("src/app/inbox/actions.ts", "utf8");
    for (const t of FULL_BAN) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    }
  });
});
