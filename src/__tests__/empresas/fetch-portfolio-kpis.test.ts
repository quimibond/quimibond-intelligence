import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("fetchPortfolioKpis — source scan", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/queries/_shared/companies.ts"),
    "utf8"
  );

  it("exports fetchPortfolioKpis", () => {
    expect(src).toMatch(/export\s+async\s+function\s+fetchPortfolioKpis/);
  });

  it("reads gold_company_360 (not rfm_segments or customer_ltv_health)", () => {
    const startIdx = src.indexOf("fetchPortfolioKpis");
    expect(startIdx).toBeGreaterThan(-1);
    const afterFn = src.slice(startIdx);
    const nextExportIdx = afterFn.indexOf("\nexport ", 50);
    const body = afterFn.slice(0, nextExportIdx > -1 ? nextExportIdx : 2000);
    expect(body).toMatch(/from\(['"]gold_company_360['"]/);
    expect(body).not.toMatch(/rfm_segments|customer_ltv_health|company_profile_sat/);
  });
});
