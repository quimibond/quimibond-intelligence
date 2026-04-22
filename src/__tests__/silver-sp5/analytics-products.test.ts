import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("analytics/products.ts — canonical/gold reads", () => {
  let listProducts: (opts?: { search?: string; limit?: number }) => Promise<unknown[]>;
  let fetchProductPerformance: (canonical_product_id: number) => Promise<unknown>;
  let fetchTopSkusByRevenue: (opts?: { limit?: number }) => Promise<unknown[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/analytics/products");
    listProducts = mod.listProducts ?? mod.searchProducts;
    fetchProductPerformance = mod.fetchProductPerformance ?? mod.getProductPerformance;
    fetchTopSkusByRevenue = mod.fetchTopSkusByRevenue ?? mod.topProductsByRevenue;
  });

  it("listProducts returns canonical_products rows", async () => {
    const rows = await listProducts({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("id");
      expect(rows[0]).toHaveProperty("internal_ref");
      expect(rows[0]).toHaveProperty("display_name");
    }
  });

  it("fetchTopSkusByRevenue returns gold_product_performance-derived rows", async () => {
    const rows = await fetchTopSkusByRevenue({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe("analytics/products.ts — source has no banned legacy reads", () => {
  it("products.ts legacy table bans", () => {
    const src = readFileSync("src/lib/queries/analytics/products.ts", "utf8");
    const banned = [
      "from('product_margin_analysis",
      "from('customer_product_matrix",
      "from('supplier_product_matrix",
      "from('supplier_price_index",
      "from('product_price_history",
      "from('products_unified",
    ];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
