/**
 * Shared persistence for Gmail emails + threads.
 *
 * Used by both incremental sync and historical backfill. Centralizes the
 * critical invariant: emails.thread_id (bigint FK to threads.id) MUST be
 * populated at insert time so JOINs work. We learned this the hard way
 * after 423 emails landed orphaned because the original sync-emails route
 * inserted emails before threads existed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedEmail } from "@/lib/pipeline/gmail";

interface PersistResult {
  emails_saved: number;
  threads_saved: number;
  emails_missing_thread: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function persistEmailsAndThreads(
  supabase: SupabaseClient,
  validEmails: ParsedEmail[],
): Promise<PersistResult> {
  if (!validEmails.length) {
    return { emails_saved: 0, threads_saved: 0, emails_missing_thread: 0 };
  }

  // 1. Group by gmail_thread_id and build thread rows
  const threadMap = new Map<string, ParsedEmail[]>();
  for (const e of validEmails) {
    const tid = e.gmail_thread_id;
    if (!threadMap.has(tid)) threadMap.set(tid, []);
    threadMap.get(tid)!.push(e);
  }

  const threadRows = [...threadMap.entries()].map(([tid, msgs]) => {
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    const hasInternal = msgs.some((m) => m.sender_type === "internal");
    const hasExternal = msgs.some((m) => m.sender_type === "external");
    const hoursNoResponse =
      last.sender_type === "external"
        ? (Date.now() - new Date(last.date).getTime()) / 3600000
        : 0;

    return {
      gmail_thread_id: tid,
      subject: first.subject,
      subject_normalized: first.subject_normalized,
      started_by: first.from_email,
      started_by_type: first.sender_type,
      started_at: new Date(first.date).toISOString(),
      last_activity: new Date(last.date).toISOString(),
      status:
        hoursNoResponse > 48
          ? "stalled"
          : hoursNoResponse > 24
            ? "needs_response"
            : msgs.length === 1
              ? "new"
              : "active",
      message_count: msgs.length,
      participant_emails: [...new Set(msgs.map((m) => m.from_email))],
      has_internal_reply: hasInternal,
      has_external_reply: hasExternal,
      last_sender: last.from_email,
      last_sender_type: last.sender_type,
      hours_without_response: Math.round(hoursNoResponse * 10) / 10,
      account: first.account,
    };
  });

  // 2. Upsert threads first and capture id ↔ gmail_thread_id mapping
  const threadIdByGmail = new Map<string, number>();
  if (threadRows.length) {
    const { data: upserted, error: threadErr } = await supabase
      .from("threads")
      .upsert(threadRows, { onConflict: "gmail_thread_id" })
      .select("id, gmail_thread_id");

    if (threadErr) {
      console.error("[email-persist] thread upsert failed", threadErr);
    }
    for (const t of upserted ?? []) {
      threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
    }
  }

  // Fallback: any gmail_thread_ids not returned by the upsert (e.g. existing
  // rows with full duplicates) — fetch them so emails never land null.
  const missing = [...threadMap.keys()].filter((tid) => !threadIdByGmail.has(tid));
  if (missing.length) {
    const { data: fetched } = await supabase
      .from("threads")
      .select("id, gmail_thread_id")
      .in("gmail_thread_id", missing);
    for (const t of fetched ?? []) {
      threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
    }
  }

  // 3. Insert emails with thread_id resolved
  const emailRows = validEmails.map((e) => ({
    account: e.account,
    sender: e.from,
    recipient: e.to,
    subject: e.subject,
    body: e.body,
    snippet: e.snippet,
    email_date: new Date(e.date).toISOString(),
    gmail_message_id: e.gmail_message_id,
    gmail_thread_id: e.gmail_thread_id,
    thread_id: threadIdByGmail.get(e.gmail_thread_id) ?? null,
    attachments: e.attachments.length ? e.attachments : null,
    is_reply: e.is_reply,
    sender_type: e.sender_type,
    has_attachments: e.has_attachments,
  }));

  let saved = 0;
  let missingThread = 0;
  for (const batch of chunk(emailRows, 50)) {
    missingThread += batch.filter((b) => b.thread_id === null).length;
    const { error } = await supabase
      .from("emails")
      .upsert(batch, { onConflict: "gmail_message_id", ignoreDuplicates: true });
    if (!error) saved += batch.length;
    else console.error("[email-persist] email batch upsert failed", error);
  }

  if (missingThread > 0) {
    console.warn(
      `[email-persist] ${missingThread} emails inserted without thread_id — thread upsert likely failed`,
    );
  }

  return {
    emails_saved: saved,
    threads_saved: threadRows.length,
    emails_missing_thread: missingThread,
  };
}
