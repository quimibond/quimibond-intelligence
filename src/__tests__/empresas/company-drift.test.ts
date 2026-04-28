import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  driftTone,
  shouldShowDriftTab,
  type CompanyDriftAggregates,
} from "@/lib/queries/canonical/company-drift";

const mockChain: Record<string, unknown> = {};
const state: {
  resolvedData: unknown;
  resolvedError: unknown;
  capturedTable: string | null;
  capturedFilters: Array<{ method: string; args: unknown[] }>;
} = {
  resolvedData: null,
  resolvedError: null,
  capturedTable: null,
  capturedFilters: [],
};

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      state.capturedTable = table;
      return mockChain;
    },
  }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
}));

beforeEach(() => {
  state.resolvedData = null;
  state.resolvedError = null;
  state.capturedTable = null;
  state.capturedFilters = [];
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      state.capturedFilters.push({ method, args });
      return chain;
    };
  for (const m of ["select", "eq", "in", "lt", "gt", "not", "or", "order", "limit"]) {
    chain[m] = record(m);
  }
  // .maybeSingle() resolves the promise directly with { data, error }.
  chain.maybeSingle = () =>
    Promise.resolve({ data: state.resolvedData, error: state.resolvedError });
  // Thenable terminator for chains that don't end in maybeSingle / single.
  (chain as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    Promise.resolve({ data: state.resolvedData, error: state.resolvedError }).then(
      cb,
    );
  Object.assign(mockChain, chain);
});

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

describe("getCompanyDrift", () => {
  it("returns null when canonical_companies has no row", async () => {
    state.resolvedData = null;
    const mod = await import("@/lib/queries/canonical/company-drift");
    expect(await mod.getCompanyDrift(99999)).toBeNull();
    expect(state.capturedTable).toBe("canonical_companies");
    const eqCall = state.capturedFilters.find((f) => f.method === "eq");
    expect(eqCall?.args).toEqual(["id", 99999]);
  });

  it("coerces null numeric drift_* fields to 0 and bool flags to false", async () => {
    state.resolvedData = {
      id: 42,
      display_name: "Empresa 42",
      rfc: null,
      drift_sat_only_count: null,
      drift_sat_only_mxn: null,
      drift_odoo_only_count: null,
      drift_odoo_only_mxn: null,
      drift_matched_diff_count: null,
      drift_matched_abs_mxn: null,
      drift_total_abs_mxn: null,
      drift_needs_review: null,
      drift_last_computed_at: null,
      drift_ap_sat_only_count: null,
      drift_ap_sat_only_mxn: null,
      drift_ap_odoo_only_count: null,
      drift_ap_odoo_only_mxn: null,
      drift_ap_matched_diff_count: null,
      drift_ap_matched_abs_mxn: null,
      drift_ap_total_abs_mxn: null,
      drift_ap_needs_review: null,
      is_foreign: null,
      is_bank: null,
      is_government: null,
      is_payroll_entity: null,
    };
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getCompanyDrift(42);
    expect(out).not.toBeNull();
    expect(out!.canonical_company_id).toBe(42);
    expect(out!.drift_total_abs_mxn).toBe(0);
    expect(out!.drift_ap_total_abs_mxn).toBe(0);
    expect(out!.drift_needs_review).toBe(false);
    expect(out!.is_foreign).toBe(false);
    expect(out!.is_bank).toBe(false);
    expect(out!.is_government).toBe(false);
    expect(out!.is_payroll_entity).toBe(false);
    expect(out!.rfc).toBeNull();
  });

  it("preserves real numeric + boolean values through toAggregates", async () => {
    state.resolvedData = {
      id: 918,
      display_name: "ENTRETELAS BRINCO",
      rfc: "EBR123456789",
      drift_sat_only_count: 43,
      drift_sat_only_mxn: 24_500_000,
      drift_odoo_only_count: 0,
      drift_odoo_only_mxn: 0,
      drift_matched_diff_count: 2,
      drift_matched_abs_mxn: 1500,
      drift_total_abs_mxn: 24_500_000,
      drift_needs_review: true,
      drift_last_computed_at: "2026-04-28T19:45:00Z",
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
    };
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getCompanyDrift(918);
    expect(out).toEqual({
      canonical_company_id: 918,
      display_name: "ENTRETELAS BRINCO",
      rfc: "EBR123456789",
      drift_sat_only_count: 43,
      drift_sat_only_mxn: 24_500_000,
      drift_odoo_only_count: 0,
      drift_odoo_only_mxn: 0,
      drift_matched_diff_count: 2,
      drift_matched_abs_mxn: 1500,
      drift_total_abs_mxn: 24_500_000,
      drift_needs_review: true,
      drift_last_computed_at: "2026-04-28T19:45:00Z",
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
    });
  });

  it("propagates Supabase errors", async () => {
    state.resolvedError = new Error("connection refused");
    const mod = await import("@/lib/queries/canonical/company-drift");
    await expect(mod.getCompanyDrift(1)).rejects.toThrow("connection refused");
  });
});

describe("getCompanyDriftRows", () => {
  it("reads gold_company_odoo_sat_drift filtered by canonical_company_id", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918);
    expect(state.capturedTable).toBe("gold_company_odoo_sat_drift");
    const eqCall = state.capturedFilters.find(
      (f) => f.method === "eq" && f.args[0] === "canonical_company_id",
    );
    expect(eqCall?.args).toEqual(["canonical_company_id", 918]);
  });

  it("does NOT add side filter when opts.side is omitted", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918);
    const sideEq = state.capturedFilters.find(
      (f) => f.method === "eq" && f.args[0] === "side",
    );
    expect(sideEq).toBeUndefined();
  });

  it("adds side filter when opts.side is provided", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918, { side: "customer" });
    const sideEq = state.capturedFilters.find(
      (f) => f.method === "eq" && f.args[0] === "side",
    );
    expect(sideEq?.args).toEqual(["side", "customer"]);
  });

  it("caps limit at DRIFT_ROWS_HARD_CAP (200) even when caller passes more", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918, { limit: 5000 });
    const limitCall = state.capturedFilters.find((f) => f.method === "limit");
    expect(limitCall?.args).toEqual([200]);
  });

  it("uses caller-provided limit when below the cap", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918, { limit: 50 });
    const limitCall = state.capturedFilters.find((f) => f.method === "limit");
    expect(limitCall?.args).toEqual([50]);
  });

  it("defaults to DRIFT_ROWS_HARD_CAP when no limit provided", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getCompanyDriftRows(918);
    const limitCall = state.capturedFilters.find((f) => f.method === "limit");
    expect(limitCall?.args).toEqual([200]);
  });

  it("coerces string-typed mxn fields (Postgres numerics returned as strings) to numbers", async () => {
    state.resolvedData = [
      {
        side: "customer",
        canonical_company_id: 918,
        display_name: "ENTRETELAS BRINCO",
        canonical_id: 1234,
        drift_kind: "sat_only",
        invoice_date: "2026-03-15",
        sat_uuid: "abc-uuid",
        odoo_invoice_id: null,
        odoo_name: null,
        // Postgres numeric returns as string in JS — must coerce.
        sat_mxn: "569767.39",
        odoo_mxn: null,
        diff_mxn: "569767.39",
      },
    ];
    const mod = await import("@/lib/queries/canonical/company-drift");
    const rows = await mod.getCompanyDriftRows(918);
    expect(rows).toHaveLength(1);
    expect(rows[0].sat_mxn).toBe(569767.39);
    expect(rows[0].odoo_mxn).toBeNull();
    expect(rows[0].diff_mxn).toBe(569767.39);
  });

  it("propagates Supabase errors", async () => {
    state.resolvedError = new Error("gold view stale");
    const mod = await import("@/lib/queries/canonical/company-drift");
    await expect(mod.getCompanyDriftRows(1)).rejects.toThrow("gold view stale");
  });
});

describe("getNonZeroDriftSummary", () => {
  it("filters via .or() to drift_total_abs_mxn.gt.0 OR drift_ap_total_abs_mxn.gt.0", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    await mod.getNonZeroDriftSummary();
    expect(state.capturedTable).toBe("canonical_companies");
    const orCall = state.capturedFilters.find((f) => f.method === "or");
    expect(orCall?.args).toEqual([
      "drift_total_abs_mxn.gt.0,drift_ap_total_abs_mxn.gt.0",
    ]);
  });

  it("returns empty object when there are no drift rows", async () => {
    state.resolvedData = [];
    const mod = await import("@/lib/queries/canonical/company-drift");
    expect(await mod.getNonZeroDriftSummary()).toEqual({});
  });

  it("aggregates AR + AP totals into a single total_abs_mxn", async () => {
    state.resolvedData = [
      {
        id: 100,
        drift_total_abs_mxn: 1000,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 500,
        drift_ap_needs_review: false,
      },
    ];
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getNonZeroDriftSummary();
    expect(out[100]).toEqual({ total_abs_mxn: 1500, needs_review: false });
  });

  it("sets needs_review=true when either AR or AP flag is true", async () => {
    state.resolvedData = [
      {
        id: 1,
        drift_total_abs_mxn: 100,
        drift_needs_review: true,
        drift_ap_total_abs_mxn: 0,
        drift_ap_needs_review: false,
      },
      {
        id: 2,
        drift_total_abs_mxn: 0,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 200,
        drift_ap_needs_review: true,
      },
      {
        id: 3,
        drift_total_abs_mxn: 50,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 50,
        drift_ap_needs_review: false,
      },
    ];
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getNonZeroDriftSummary();
    expect(out[1].needs_review).toBe(true);
    expect(out[2].needs_review).toBe(true);
    expect(out[3].needs_review).toBe(false);
  });

  it("coerces null totals to 0 in the sum", async () => {
    state.resolvedData = [
      {
        id: 7,
        drift_total_abs_mxn: null,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 300,
        drift_ap_needs_review: false,
      },
    ];
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getNonZeroDriftSummary();
    expect(out[7]).toEqual({ total_abs_mxn: 300, needs_review: false });
  });

  it("propagates Supabase errors", async () => {
    state.resolvedError = new Error("denied");
    const mod = await import("@/lib/queries/canonical/company-drift");
    await expect(mod.getNonZeroDriftSummary()).rejects.toThrow("denied");
  });
});

describe("getDriftSummaryMap (legacy subset wrapper)", () => {
  it("returns empty without hitting Supabase when id list is empty", async () => {
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getDriftSummaryMap([]);
    expect(out).toEqual({});
    // No Supabase call should have been made.
    expect(state.capturedTable).toBeNull();
  });

  it("returns only the subset of ids requested", async () => {
    state.resolvedData = [
      {
        id: 1,
        drift_total_abs_mxn: 100,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 0,
        drift_ap_needs_review: false,
      },
      {
        id: 2,
        drift_total_abs_mxn: 200,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 0,
        drift_ap_needs_review: false,
      },
      {
        id: 3,
        drift_total_abs_mxn: 300,
        drift_needs_review: false,
        drift_ap_total_abs_mxn: 0,
        drift_ap_needs_review: false,
      },
    ];
    const mod = await import("@/lib/queries/canonical/company-drift");
    const out = await mod.getDriftSummaryMap([1, 3, 999]);
    expect(out).toEqual({
      1: { total_abs_mxn: 100, needs_review: false },
      3: { total_abs_mxn: 300, needs_review: false },
    });
    // 999 not in upstream data → omitted
    expect(out[999]).toBeUndefined();
    // 2 in upstream but not in requested ids → omitted
    expect(out[2]).toBeUndefined();
  });
});
