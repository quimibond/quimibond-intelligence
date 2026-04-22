import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

// ORIGINALES ARDI = canonical_company_id 2104 (732 sale orders — highest volume company)
const HIGH_VOLUME_COMPANY_ID = 2104;

// ──────────────────────────────────────────────────────────────────────────
// File-inspection tests — always run, no DB env required
// ──────────────────────────────────────────────────────────────────────────
describe("_shared/companies.ts — source contains no banned legacy reads", () => {
  it("has no legacy table references", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/_shared/companies.ts", "utf8");
    const banned = [
      "from('odoo_sale_orders",
      "from('odoo_deliveries",
      "from('odoo_order_lines",
      'from("odoo_order_lines',
      "from('company_profile",
      "from('company_profile_sat",
      "from('customer_ltv_health",
      "from('company_narrative",
      "from('portfolio_concentration",
      "from('analytics_customer_360",
      "from('monthly_revenue_by_company",
    ];
    for (const token of banned) {
      expect(src).not.toContain(token);
    }
  });
  // odoo_activities intentionally omitted — SP5-EXCEPTION allowed for that single read
  it("odoo_activities references are annotated SP5-EXCEPTION", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/_shared/companies.ts", "utf8");
    const lines = src.split("\n");
    const odooActivityLines = lines.filter((l) => /\.from\(['"]odoo_activities/.test(l));
    for (const line of odooActivityLines) {
      expect(line).toContain("SP5-EXCEPTION");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Integration tests — require DB env (skipped without credentials)
// ──────────────────────────────────────────────────────────────────────────
describeIntegration("_shared/companies.ts — canonical reads", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchCompanyById: (id: number) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listCompanies: (opts: { search?: string; limit?: number }) => Promise<unknown[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchCompany360: (canonical_company_id: number) => Promise<any>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/companies");
    fetchCompanyById = mod.fetchCompanyById ?? mod.getCompanyById;
    listCompanies = mod.listCompanies ?? mod.searchCompanies;
    fetchCompany360 = mod.fetchCompany360 ?? mod.getCompany360;
    if (!fetchCompanyById) throw new Error("fetchCompanyById export missing after rewire");
    if (!fetchCompany360) throw new Error("fetchCompany360 export missing after rewire");
  });

  it("fetchCompanyById returns a canonical_companies row shape for Quimibond (id=868)", async () => {
    // Schema drift note: plan used taxpayer_rfc/is_shadow but actual columns are rfc/has_shadow_flag
    // Quimibond id=868: display_name=PRODUCTORA DE NO TEJIDOS QUIMIBOND, rfc=PNT920218IW5
    const row = await fetchCompanyById(868);
    expect(row).toBeTruthy();
    expect(row.id).toBe(868);
    // Live RFC verified via Supabase: PNT920218IW5 (not QIN140528HN9 from plan — plan had wrong entity)
    expect(row.rfc).toBe("PNT920218IW5");
    expect(row).toHaveProperty("display_name");
    expect(row).toHaveProperty("is_internal");
    expect(row).toHaveProperty("has_shadow_flag");
  });

  it("fetchCompany360 returns gold_company_360 enrichment", async () => {
    const contitech = await sb()
      .from("canonical_companies")
      .select("id")
      .ilike("display_name", "%CONTITECH%")
      .limit(1);
    expect(contitech.data?.length).toBe(1);
    const row = await fetchCompany360(contitech.data![0].id);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty("lifetime_value_mxn");
    expect(row).toHaveProperty("revenue_ytd_mxn");
    expect(row).toHaveProperty("open_company_issues_count");
    expect(Number(row.lifetime_value_mxn)).toBeGreaterThan(0);
  });

  it("listCompanies returns shape-compatible results from canonical_companies", async () => {
    const rows = await listCompanies({ limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("canonical_company_id");
    expect(rows[0]).toHaveProperty("display_name");
    expect(rows[0]).toHaveProperty("rfc");
  });

  it("getCompanyOrders reads canonical_sale_orders (returns array with rows)", async () => {
    const mod = await import("@/lib/queries/_shared/companies");
    // ORIGINALES ARDI = canonical_company_id 2104 (732 sale orders, highest volume)
    const rows = await mod.getCompanyOrders(HIGH_VOLUME_COMPANY_ID, 15);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("name");
    expect(rows[0]).toHaveProperty("date_order");
    expect(rows[0]).toHaveProperty("amount_total_mxn");
    expect(rows[0]).toHaveProperty("state");
    expect(rows[0]).toHaveProperty("salesperson_name");
  });

  it("getCompanyDeliveries reads canonical_deliveries (returns array)", async () => {
    const mod = await import("@/lib/queries/_shared/companies");
    const rows = await mod.getCompanyDeliveries(HIGH_VOLUME_COMPANY_ID, 15);
    expect(Array.isArray(rows)).toBe(true);
    // Not asserting length > 0 — a company can have 0 deliveries
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("id");
      expect(rows[0]).toHaveProperty("name");
      expect(rows[0]).toHaveProperty("picking_type_code");
      expect(rows[0]).toHaveProperty("scheduled_date");
      expect(rows[0]).toHaveProperty("state");
      expect(rows[0]).toHaveProperty("is_late");
    }
  });

  it("getCompanyTopProducts reads canonical_order_lines and aggregates by product", async () => {
    const mod = await import("@/lib/queries/_shared/companies");
    const rows = await mod.getCompanyTopProducts(HIGH_VOLUME_COMPANY_ID, 10);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("product_ref");
    expect(rows[0]).toHaveProperty("product_name");
    expect(rows[0]).toHaveProperty("total_qty");
    expect(rows[0]).toHaveProperty("total_revenue");
    expect(rows[0]).toHaveProperty("last_order_date");
    // Top product should be sorted by revenue descending
    if (rows.length > 1) {
      expect(rows[0].total_revenue).toBeGreaterThanOrEqual(rows[1].total_revenue);
    }
  });
});
