import { describe, expect, it } from "vitest";
import {
  driftTone,
  shouldShowDriftTab,
  type CompanyDriftAggregates,
} from "@/lib/queries/canonical/company-drift";

function mkAgg(overrides: Partial<CompanyDriftAggregates> = {}): CompanyDriftAggregates {
  return {
    canonical_company_id: 1,
    display_name: "Empresa 1",
    rfc: "AAA010101XXX",
    drift_sat_only_count: 0,
    drift_sat_only_mxn: 0,
    drift_odoo_only_count: 0,
    drift_odoo_only_mxn: 0,
    drift_matched_diff_count: 0,
    drift_matched_abs_mxn: 0,
    drift_total_abs_mxn: 0,
    drift_needs_review: false,
    drift_last_computed_at: "2026-04-23T00:00:00Z",
    drift_ap_sat_only_count: 0,
    drift_ap_sat_only_mxn: 0,
    drift_ap_odoo_only_count: 0,
    drift_ap_odoo_only_mxn: 0,
    drift_ap_matched_diff_count: 0,
    drift_ap_matched_abs_mxn: 0,
    drift_ap_total_abs_mxn: 0,
    drift_ap_needs_review: false,
    is_foreign: false,
    is_bank: false,
    is_government: false,
    is_payroll_entity: false,
    ...overrides,
  };
}

describe("driftTone", () => {
  it("returns success when total is 0 and not flagged", () => {
    expect(driftTone(0, false)).toBe("success");
    expect(driftTone(null, false)).toBe("success");
    expect(driftTone(undefined, null)).toBe("success");
  });

  it("returns warning for drift below $10k without needs_review", () => {
    expect(driftTone(500, false)).toBe("warning");
    expect(driftTone(9_999.99, false)).toBe("warning");
  });

  it("returns danger for drift >= $10k", () => {
    expect(driftTone(10_000, false)).toBe("danger");
    expect(driftTone(1_000_000, false)).toBe("danger");
  });

  it("returns danger when needs_review is true regardless of amount", () => {
    expect(driftTone(0, true)).toBe("danger");
    expect(driftTone(50, true)).toBe("danger");
  });
});

describe("shouldShowDriftTab", () => {
  it("returns false when agg is null", () => {
    expect(shouldShowDriftTab(null)).toBe(false);
  });

  it("returns false when both AR and AP totals are 0", () => {
    expect(shouldShowDriftTab(mkAgg())).toBe(false);
  });

  it("returns true when AR drift > 0", () => {
    expect(shouldShowDriftTab(mkAgg({ drift_total_abs_mxn: 100 }))).toBe(true);
  });

  it("returns true when AP drift > 0", () => {
    expect(shouldShowDriftTab(mkAgg({ drift_ap_total_abs_mxn: 100 }))).toBe(true);
  });

  it("returns true for ENTRETELAS BRINCO fixture (AR drift $24.5M)", () => {
    // docs/superpowers/plans/2026-04-24-odoo-sat-drift-hardening.md · DoD fixture
    expect(
      shouldShowDriftTab(
        mkAgg({
          canonical_company_id: 918,
          display_name: "ENTRETELAS BRINCO",
          drift_sat_only_count: 43,
          drift_sat_only_mxn: 24_500_000,
          drift_total_abs_mxn: 24_500_000,
          drift_needs_review: true,
        }),
      ),
    ).toBe(true);
  });

  it("returns false for Contitech (id=1448) post-autolink (clean)", () => {
    expect(
      shouldShowDriftTab(
        mkAgg({
          canonical_company_id: 1448,
          display_name: "Contitech",
          drift_total_abs_mxn: 0,
          drift_ap_total_abs_mxn: 0,
          drift_needs_review: false,
          drift_ap_needs_review: false,
        }),
      ),
    ).toBe(false);
  });
});
