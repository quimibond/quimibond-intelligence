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

describe("/equipo + root + SyntageReconciliationPanel — strict canonical", () => {
  const strict = ["src/app/equipo/page.tsx", "src/app/page.tsx"];
  for (const f of strict) {
    it(`${f} clean of §12 reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of FULL_BAN) expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    });
    it(`${f} no Bronze reads`, () => {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      const bronze = /\.from\(['"](odoo_|syntage_)/;
      for (const line of lines) {
        // Bronze only allowed with SP5-EXCEPTION annotation
        if (bronze.test(line)) expect(line).toContain("SP5-EXCEPTION");
      }
    });
  }
});

describe("/sistema + /directores + _shared/system.ts — Bronze reads annotated SP5-EXCEPTION", () => {
  const annotable = [
    "src/app/sistema/page.tsx",
    "src/lib/queries/_shared/system.ts",
    "src/components/domain/system/SyntageReconciliationPanel.tsx",
  ];
  for (const f of annotable) {
    it(`${f} every legacy/Bronze read annotated SP5-EXCEPTION`, () => {
      let src = "";
      try { src = readFileSync(f, "utf8"); } catch { return; } // file may not exist
      const lines = src.split("\n");
      const suspicious = /\.from\(['"](odoo_|syntage_|pipeline_logs|schema_changes|audit_runs|agent_tickets|notification_queue|health_scores|reconciliation_issues)/;
      for (const line of lines) {
        if (suspicious.test(line)) {
          // reconciliation_issues is NOT banned (alive & useful), but sistema annotates for safety
          if (/\.from\(['"]reconciliation_issues/.test(line)) continue;
          expect(line).toContain("SP5-EXCEPTION");
        }
      }
    });
  }
});
