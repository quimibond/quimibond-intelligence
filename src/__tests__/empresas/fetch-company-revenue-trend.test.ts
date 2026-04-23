import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("fetchCompanyRevenueTrend — source scan", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/queries/_shared/companies.ts"),
    "utf8"
  );

  it("exports fetchCompanyRevenueTrend", () => {
    expect(src).toMatch(/export\s+async\s+function\s+fetchCompanyRevenueTrend/);
  });

  it("reads gold_revenue_monthly (not monthly_revenue_by_company or similar)", () => {
    const startIdx = src.indexOf("fetchCompanyRevenueTrend");
    expect(startIdx).toBeGreaterThan(-1);
    const afterFn = src.slice(startIdx);
    const nextExportIdx = afterFn.indexOf("\nexport ", 50);
    const body = afterFn.slice(0, nextExportIdx > -1 ? nextExportIdx : 2000);
    expect(body).toMatch(/from\(['"]gold_revenue_monthly['"]/);
    expect(body).not.toMatch(/monthly_revenue_by_company|monthly_revenue_trend/);
  });
});
