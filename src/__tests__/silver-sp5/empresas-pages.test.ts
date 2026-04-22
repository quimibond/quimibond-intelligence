import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
    }
  } catch { /* dir missing */ }
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

// SP5 T13 scope: empresas pages + company-link pattern
const ROOT = process.cwd();
const EMPRESAS_DIR = join(ROOT, "src/app/empresas");
const COMPANY_LINK = join(ROOT, "src/components/patterns/company-link.tsx");

describe("/empresas + CompanyLink — no §12 legacy reads", () => {
  const files = [...walk(EMPRESAS_DIR), COMPANY_LINK];

  for (const f of files) {
    it(`${f.replace(ROOT, "")} — clean of §12 drop-list reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of FULL_BAN) {
        expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
      }
    });
  }

  it("PanoramaTab — no direct odoo_ Bronze reads", () => {
    const src = readFileSync(
      join(ROOT, "src/app/empresas/[id]/_components/PanoramaTab.tsx"),
      "utf8",
    );
    for (const t of ["from('odoo_", 'from("odoo_']) {
      expect(src).not.toContain(t);
    }
  });

  it("CompanyLink — href uses /empresas/ canonical route (not /companies/)", () => {
    const src = readFileSync(COMPANY_LINK, "utf8");
    expect(src).toContain("/empresas/");
    expect(src).not.toContain('href={`/companies/');
    expect(src).not.toContain("href={`/companies/");
  });

  it("empresas/page.tsx — rowHref uses /empresas/ canonical route", () => {
    const src = readFileSync(join(ROOT, "src/app/empresas/page.tsx"), "utf8");
    // All rowHref calls should point to /empresas/, not /companies/
    expect(src).not.toContain("`/companies/${");
  });

  it("empresas/[id]/page.tsx — uses getCompanyDetail from _shared/companies (canonical)", () => {
    const src = readFileSync(join(ROOT, "src/app/empresas/[id]/page.tsx"), "utf8");
    expect(src).toContain("_shared/companies");
    // Must not have any direct legacy Bronze reads
    for (const t of FULL_BAN) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${t}['"]`));
    }
  });
});
