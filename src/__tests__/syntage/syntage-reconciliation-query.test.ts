import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

import { getSyntageReconciliationSummary } from "@/lib/queries/syntage-reconciliation";
import { getServiceClient } from "@/lib/supabase-server";

describe("getSyntageReconciliationSummary", () => {
  it("returns the RPC result cast to the expected shape", async () => {
    const mockPayload = {
      by_type: [
        { type: "cancelled_but_posted", open: 12, resolved_7d: 3, severity: "high" },
      ],
      by_severity: { critical: 2, high: 18, medium: 45, low: 103 },
      top_companies: [{ company_id: 42, name: "Acme", open: 8 }],
      resolution_rate_7d: 0.67,
      recent_critical: [
        {
          issue_id: "abc",
          type: "sat_only_cfdi_issued",
          severity: "critical",
          description: "...",
          company: "Acme",
          company_id: 42,
          odoo_invoice_id: null,
          uuid_sat: "U-1",
          amount_diff: null,
          detected_at: "2026-04-17T00:00:00Z",
        },
      ],
      generated_at: "2026-04-17T18:00:00Z",
      invoices_unified_refreshed_at: "2026-04-17T17:45:00Z",
      payments_unified_refreshed_at: "2026-04-17T17:45:00Z",
    };
    const mockRpc = vi.fn().mockResolvedValue({ data: mockPayload, error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const result = await getSyntageReconciliationSummary();
    expect(mockRpc).toHaveBeenCalledWith("get_syntage_reconciliation_summary");
    expect(result.by_type[0].type).toBe("cancelled_but_posted");
    expect(result.by_severity.critical).toBe(2);
    expect(result.resolution_rate_7d).toBe(0.67);
  });

  it("throws when RPC returns an error", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "oops" } });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    await expect(getSyntageReconciliationSummary()).rejects.toThrow("oops");
  });

  it("returns safe defaults when data is null", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const result = await getSyntageReconciliationSummary();
    expect(result.by_type).toEqual([]);
    expect(result.by_severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(result.top_companies).toEqual([]);
    expect(result.recent_critical).toEqual([]);
    expect(result.resolution_rate_7d).toBe(0);
  });
});
