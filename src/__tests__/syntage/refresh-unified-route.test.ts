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

// SP5 Task 29: invoices_unified retired — endpoint always returns 410 Gone.
describe("POST /api/syntage/refresh-unified", () => {
  it("returns 410 Gone (endpoint retired in SP5 Task 29)", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("retired");
  });
});
