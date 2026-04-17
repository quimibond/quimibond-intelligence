import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock supabase-server BEFORE importing route
vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

// Mock auth to always pass when Bearer is correct
vi.mock("@/lib/pipeline/auth", () => ({
  validatePipelineAuth: vi.fn((req: NextRequest) => {
    if (req.headers.get("authorization") === "Bearer test-secret") return null;
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }),
}));

import { POST } from "@/app/api/syntage/refresh-unified/route";
import { getServiceClient } from "@/lib/supabase-server";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/syntage/refresh-unified", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/syntage/refresh-unified", () => {
  it("returns 401 when auth missing", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with refresh results when auth valid", async () => {
    const mockRpc = vi.fn()
      .mockResolvedValueOnce({ data: { invoices_unified_rows: 100, issues_opened: 5, issues_resolved: 2, duration_ms: 1234 }, error: null })
      .mockResolvedValueOnce({ data: { payments_unified_rows: 30, issues_opened: 1, issues_resolved: 0, duration_ms: 500 },  error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const res = await POST(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invoices).toMatchObject({ invoices_unified_rows: 100, issues_opened: 5 });
    expect(body.payments).toMatchObject({ payments_unified_rows: 30 });
    expect(mockRpc).toHaveBeenCalledWith("refresh_invoices_unified");
    expect(mockRpc).toHaveBeenCalledWith("refresh_payments_unified");
  });

  it("returns 500 when RPC fails", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const res = await POST(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("boom");
  });
});
