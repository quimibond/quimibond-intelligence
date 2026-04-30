import { z } from "zod";
import { unstable_cache } from "next/cache";

import { getServiceClient } from "@/lib/supabase-server";

export const CommsThreadSchema = z.object({
  thread_id: z.number(),
  gmail_thread_id: z.string(),
  subject: z.string().nullable(),
  last_activity: z.string().nullable(),
  last_sender: z.string().nullable(),
  last_sender_type: z.string().nullable(),
  hours_without_response: z.number().nullable(),
  status: z.string().nullable(),
  message_count: z.number(),
  has_internal_reply: z.boolean(),
  has_external_reply: z.boolean(),
  participant_emails: z.array(z.string()).nullable(),
  severity: z.enum(["high", "medium", "low", "none"]),
  total_count: z.number(),
});

export type CommsThread = z.infer<typeof CommsThreadSchema>;

export type CommsScope = "external" | "internal" | "all";

export type CommsTimelinePayload = {
  threads: CommsThread[];
  total: number;
  hasMore: boolean;
};

export type CommsEntityType = "company" | "contact";

export interface GetCommsTimelineArgs {
  entityType: CommsEntityType;
  entityId: number;
  scope?: CommsScope;
  limit?: number;
  offset?: number;
}

const EMPTY: CommsTimelinePayload = { threads: [], total: 0, hasMore: false };

async function fetchCommsTimeline(args: GetCommsTimelineArgs): Promise<CommsTimelinePayload> {
  const { entityType, entityId, scope = "external", limit = 25, offset = 0 } = args;
  try {
    const supabase = await getServiceClient();
    const { data, error } = await supabase.rpc("comms_timeline", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_scope: scope,
      p_limit: limit,
      p_offset: offset,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[comms_timeline] rpc error", error);
      return EMPTY;
    }
    const parsed = z.array(CommsThreadSchema).safeParse(data);
    if (!parsed.success) {
      console.error("[comms_timeline] zod parse error", parsed.error.issues.slice(0, 3));
      return EMPTY;
    }
    const total = parsed.data[0]?.total_count ?? 0;
    return {
      threads: parsed.data,
      total,
      hasMore: offset + limit < total,
    };
  } catch (err) {
    console.error("[comms_timeline] unexpected", err);
    return EMPTY;
  }
}

export async function getCommsTimeline(
  args: GetCommsTimelineArgs
): Promise<CommsTimelinePayload> {
  const cacheKey = `comms-timeline-v1:${args.entityType}:${args.entityId}:${args.scope ?? "external"}:${args.limit ?? 25}:${args.offset ?? 0}`;
  return unstable_cache(() => fetchCommsTimeline(args), [cacheKey], {
    revalidate: 60,
    tags: [`comms:${args.entityType}:${args.entityId}`],
  })();
}
