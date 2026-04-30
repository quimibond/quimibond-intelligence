import { z } from "zod";

import { getServiceClient } from "@/lib/supabase-server";

export const CommsMessageSchema = z.object({
  email_id: z.number(),
  gmail_message_id: z.string(),
  sender: z.string(),
  recipient: z.string().nullable(),
  email_date: z.string().nullable(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  body: z.string().nullable(),
  sender_type: z.string().nullable(),
  has_attachments: z.boolean().nullable(),
});

export type CommsMessage = z.infer<typeof CommsMessageSchema>;

export async function getCommsThreadMessages(threadId: number): Promise<CommsMessage[]> {
  try {
    const supabase = await getServiceClient();
    const { data, error } = await supabase.rpc("comms_thread_messages", {
      p_thread_id: threadId,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[comms_thread_messages] rpc error", error);
      return [];
    }
    const parsed = z.array(CommsMessageSchema).safeParse(data);
    if (!parsed.success) {
      console.error("[comms_thread_messages] zod parse error", parsed.error.issues.slice(0, 3));
      return [];
    }
    return parsed.data;
  } catch (err) {
    console.error("[comms_thread_messages] unexpected", err);
    return [];
  }
}
