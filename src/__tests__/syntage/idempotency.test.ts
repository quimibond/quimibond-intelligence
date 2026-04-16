// src/__tests__/syntage/idempotency.test.ts
import { describe, it, expect } from "vitest";
import { recordWebhookEvent } from "@/lib/syntage/idempotency";

describe("recordWebhookEvent", () => {
  it("returns 'fresh' on first insert (count=1)", async () => {
    const stub = {
      async insert(_eventId: string, _eventType: string, _source: string) {
        return { inserted: true };
      },
    };
    const result = await recordWebhookEvent(
      stub as unknown as Parameters<typeof recordWebhookEvent>[0],
      "evt_1", "invoice.created", "webhook",
    );
    expect(result).toBe("fresh");
  });

  it("returns 'duplicate' when event_id already exists", async () => {
    const stub = {
      async insert() { return { inserted: false }; },
    };
    const result = await recordWebhookEvent(
      stub as unknown as Parameters<typeof recordWebhookEvent>[0],
      "evt_1", "invoice.created", "webhook",
    );
    expect(result).toBe("duplicate");
  });
});
