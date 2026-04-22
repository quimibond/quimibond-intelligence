/**
 * SP5 Task 19 — Agent routes: no §12 drop-list reads.
 *
 * Rules:
 * 1. No banned §12 table must appear in a .from("<table>") call without
 *    SP5-EXCEPTION annotation on the same line.
 * 2. All Bronze odoo_* / syntage_* reads must be annotated SP5-EXCEPTION.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function walk(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name === "route.ts") out.push(p);
    }
  } catch { /* dir may not exist */ }
  return out;
}

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

describe("api/agents routes — no §12 drop-list reads without SP5-EXCEPTION", () => {
  const routes = [
    ...walk("src/app/api/agents"),
    "src/app/api/pipeline/reconcile/route.ts",
  ];

  for (const f of routes) {
    it(`${f} — §12 banned reads annotated`, () => {
      let src = "";
      try { src = readFileSync(f, "utf8"); } catch { return; }

      const lines = src.split("\n");
      for (const t of FULL_BAN) {
        // For each line that contains from("<banned>"), it must also contain SP5-EXCEPTION
        const bannedPattern = new RegExp(`from\\(['"]${t}['"]`);
        for (const line of lines) {
          if (bannedPattern.test(line)) {
            expect(line, `${f}: banned table "${t}" without SP5-EXCEPTION annotation`)
              .toContain("SP5-EXCEPTION");
          }
        }
      }
    });

    it(`${f} — Bronze odoo_* reads annotated SP5-EXCEPTION`, () => {
      let src = "";
      try { src = readFileSync(f, "utf8"); } catch { return; }

      const lines = src.split("\n");
      const bronzePattern = /\.from\(['"]odoo_/;
      for (const line of lines) {
        if (bronzePattern.test(line)) {
          expect(line, `${f}: Bronze odoo_* read without SP5-EXCEPTION annotation`)
            .toContain("SP5-EXCEPTION");
        }
      }
    });
  }
});
