import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { getCommsTimeline } from "./timeline";
import { getServiceClient } from "@/lib/supabase-server";

const mockedGetServiceClient = vi.mocked(getServiceClient);

function makeRpcReturn(rows: unknown[] | null, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rows, error }),
  } as unknown as Awaited<ReturnType<typeof getServiceClient>>;
}

describe("getCommsTimeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty payload when RPC errors (throw-safe)", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn(null, new Error("boom"))
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result).toEqual({ threads: [], total: 0, hasMore: false });
  });

  it("returns empty payload when data is null", async () => {
    mockedGetServiceClient.mockResolvedValue(makeRpcReturn(null, null));
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.threads).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("parses valid rows and computes hasMore", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([
        {
          thread_id: 10,
          gmail_thread_id: "gt_10",
          subject: "Cotización",
          last_activity: "2026-04-29T12:00:00Z",
          last_sender: "maria@cliente.com",
          last_sender_type: "external",
          hours_without_response: 96,
          status: "open",
          message_count: 4,
          has_internal_reply: true,
          has_external_reply: true,
          participant_emails: ["maria@cliente.com", "ventas@quimibond.com"],
          severity: "medium",
          total_count: 50,
        },
      ])
    );
    const result = await getCommsTimeline({
      entityType: "company",
      entityId: 1,
      limit: 25,
      offset: 0,
    });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].subject).toBe("Cotización");
    expect(result.threads[0].severity).toBe("medium");
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true); // offset(0) + limit(25) < total(50)
  });

  it("hasMore is false when offset+limit >= total", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([
        {
          thread_id: 1,
          gmail_thread_id: "gt_1",
          subject: null,
          last_activity: "2026-04-29T12:00:00Z",
          last_sender: null,
          last_sender_type: null,
          hours_without_response: null,
          status: null,
          message_count: 1,
          has_internal_reply: false,
          has_external_reply: true,
          participant_emails: null,
          severity: "none",
          total_count: 1,
        },
      ])
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.hasMore).toBe(false);
  });

  it("returns empty when rows fail Zod validation", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([{ invalid: "shape" }])
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.threads).toEqual([]);
  });
});
