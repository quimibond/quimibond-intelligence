// src/lib/syntage/idempotency.ts
/**
 * Idempotent webhook-event recorder. Returns 'fresh' on first insert,
 * 'duplicate' if the event_id was already seen.
 *
 * Uses a thin interface so it can be unit-tested with a stub, and accepts
 * either our Supabase client wrapper or the direct @supabase/supabase-js client.
 */
export interface EventStore {
  insert(eventId: string, eventType: string, source: string): Promise<{ inserted: boolean }>;
}

export async function recordWebhookEvent(
  store: EventStore,
  eventId: string,
  eventType: string,
  source: "webhook" | "reconcile",
): Promise<"fresh" | "duplicate"> {
  const res = await store.insert(eventId, eventType, source);
  return res.inserted ? "fresh" : "duplicate";
}

/**
 * Factory that builds an EventStore backed by Supabase.
 * ON CONFLICT DO NOTHING returns 0 rows if duplicate, 1 if new.
 */
export function supabaseEventStore(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): EventStore {
  return {
    async insert(eventId, eventType, source) {
      const { data, error } = await supabase
        .from("syntage_webhook_events") // SP5-EXCEPTION: SAT source-layer idempotency writer — syntage_webhook_events is the canonical Bronze dedup store for SAT webhook events.
        .insert({ event_id: eventId, event_type: eventType, source })
        .select("event_id");

      // Unique violation (23505) is expected for duplicates.
      if (error) {
        if (error.code === "23505") return { inserted: false };
        throw error;
      }
      return { inserted: (data ?? []).length > 0 };
    },
  };
}
