import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

import {
  getUnifiedRevenueAggregates,
  getUnifiedCashFlowAging,
  getUnifiedInvoicesForCompany,
  getUnifiedReconciliationCounts,
  _getUnifiedRefreshStalenessRaw as getUnifiedRefreshStaleness,
  isComputableRevenue,
} from "@/lib/queries/unified";
import { getServiceClient } from "@/lib/supabase-server";

type Row = Record<string, unknown>;

function makeClient(rows: Row[]) {
  const qb: Record<string, unknown> = {
    _rows: rows,
  };
  const builder: {
    select: (cols: string) => typeof builder;
    eq: (col: string, val: unknown) => typeof builder;
    gte: (col: string, val: unknown) => typeof builder;
    lte: (col: string, val: unknown) => typeof builder;
    or: (filter: string) => typeof builder;
    in: (col: string, vals: unknown[]) => typeof builder;
    is: (col: string, val: unknown) => typeof builder;
    not: (col: string, op: string, val: unknown) => typeof builder;
    order: (col: string, opts?: Record<string, unknown>) => typeof builder;
    limit: (n: number) => typeof builder;
    then: (cb: (v: unknown) => unknown) => unknown;
  } = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    or: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (cb) => cb({ data: rows, error: null }),
  };
  return {
    from: () => builder,
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe("isComputableRevenue", () => {
  it("returns true for match_uuid posted vigente issued", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "match_uuid",
      estado_sat: "vigente", odoo_state: "posted",
    })).toBe(true);
  });

  it("returns false for cancelled", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "match_uuid",
      estado_sat: "cancelado", odoo_state: "posted",
    })).toBe(false);
  });

  it("returns false for syntage_only", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "syntage_only",
      estado_sat: "vigente", odoo_state: null,
    })).toBe(false);
  });

  it("returns true for odoo_only posted (syntage unknown)", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "odoo_only",
      estado_sat: null, odoo_state: "posted",
    })).toBe(true);
  });
});

describe("getUnifiedRevenueAggregates", () => {
  it("reads canonical_invoices and returns aggregate shape", async () => {
    const rows = [
      { amount_total_mxn_resolved: 100, sat_uuid: "A", has_sat_record: true },
      { amount_total_mxn_resolved: 200, sat_uuid: "B", has_sat_record: true },
      { amount_total_mxn_resolved: 300, sat_uuid: null, has_sat_record: false },
    ];
    vi.mocked(getServiceClient).mockReturnValue(makeClient(rows) as never);

    const r = await getUnifiedRevenueAggregates("2026-01-01", "2026-12-31");
    expect(r.revenue).toBe(600);
    expect(r.count).toBe(3);
    expect(r.uuidValidated).toBe(2);
    expect(r.pctValidated).toBeCloseTo(66.67, 1);
  });
});

describe("getUnifiedRefreshStaleness", () => {
  it("returns minutes since most recent MV refresh", async () => {
    const ago = new Date(Date.now() - 8 * 60_000).toISOString();
    const qb = {
      select: () => qb,
      limit: () => qb,
      single: () => Promise.resolve({
        data: {
          invoices_unified_refreshed_at: ago,
          payments_unified_refreshed_at: ago,
        },
        error: null,
      }),
    };
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          invoices_unified_refreshed_at: ago,
          payments_unified_refreshed_at: ago,
        },
        error: null,
      }),
    };
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const r = await getUnifiedRefreshStaleness();
    expect(r.minutesSinceRefresh).toBeGreaterThanOrEqual(7);
    expect(r.minutesSinceRefresh).toBeLessThan(10);
  });
});

describe("getUnifiedReconciliationCounts", () => {
  it("aggregates open issues by severity", async () => {
    const rows = [
      { severity: "critical" }, { severity: "critical" },
      { severity: "high" }, { severity: "medium" }, { severity: "low" },
    ];
    vi.mocked(getServiceClient).mockReturnValue(makeClient(rows) as never);
    const r = await getUnifiedReconciliationCounts(42);
    expect(r.open).toBe(5);
    expect(r.bySeverity.critical).toBe(2);
    expect(r.bySeverity.high).toBe(1);
    expect(r.bySeverity.medium).toBe(1);
    expect(r.bySeverity.low).toBe(1);
  });
});
