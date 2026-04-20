import { getServiceClient } from "@/lib/supabase-server";

export interface WebhookEventRow {
  event_id: string | null;
  event_type: string | null;
  source: string | null;
  received_at: string | null;
}

export interface WebhookEventsSummary {
  total: number;
  last_24h: number;
  last_7d: number;
  last_30d: number;
  most_recent: string | null;
  by_type: Array<{ event_type: string; count: number }>;
}

export async function getWebhookEventsSummary(): Promise<WebhookEventsSummary> {
  const sb = getServiceClient();

  const now = Date.now();
  const h24 = new Date(now - 24 * 3600 * 1000).toISOString();
  const d7 = new Date(now - 7 * 86400 * 1000).toISOString();
  const d30 = new Date(now - 30 * 86400 * 1000).toISOString();

  const [totalQ, h24Q, d7Q, d30Q, recentQ, typesQ] = await Promise.all([
    sb.from("syntage_webhook_events").select("*", { count: "exact", head: true }),
    sb
      .from("syntage_webhook_events")
      .select("*", { count: "exact", head: true })
      .gte("received_at", h24),
    sb
      .from("syntage_webhook_events")
      .select("*", { count: "exact", head: true })
      .gte("received_at", d7),
    sb
      .from("syntage_webhook_events")
      .select("*", { count: "exact", head: true })
      .gte("received_at", d30),
    sb
      .from("syntage_webhook_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1), // intentional: most recent webhook timestamp
    sb
      .from("syntage_webhook_events")
      .select("event_type")
      .gte("received_at", d30)
      .limit(5000), // intentional: enumerate all event types in 30d for count-by-type map
  ]);

  if (totalQ.error)
    throw new Error(`webhook_events total failed: ${totalQ.error.message}`);

  const typeMap = new Map<string, number>();
  for (const r of (typesQ.data ?? []) as Array<{ event_type: string | null }>) {
    const t = r.event_type ?? "(null)";
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }
  const by_type = Array.from(typeMap.entries())
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const mostRecent =
    (recentQ.data ?? [])[0]?.received_at ?? null;

  return {
    total: totalQ.count ?? 0,
    last_24h: h24Q.count ?? 0,
    last_7d: d7Q.count ?? 0,
    last_30d: d30Q.count ?? 0,
    most_recent: mostRecent,
    by_type,
  };
}

export async function getWebhookEventsRecent(
  limit = 20
): Promise<WebhookEventRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("syntage_webhook_events")
    .select("event_id, event_type, source, received_at")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error)
    throw new Error(`webhook_events recent failed: ${error.message}`);
  return (data ?? []) as unknown as WebhookEventRow[];
}
