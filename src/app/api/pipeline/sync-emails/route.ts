import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { syncAllAccounts, type GmailAccount } from "@/lib/pipeline/gmail";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

// Vercel Crons use GET
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      return NextResponse.json(
        { error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado." },
        { status: 503 }
      );
    }

    const accountsJson = process.env.GMAIL_ACCOUNTS_JSON;
    if (!accountsJson) {
      return NextResponse.json(
        { error: "GMAIL_ACCOUNTS_JSON no configurado." },
        { status: 503 }
      );
    }

    // Support both formats:
    // Array: [{email, department}, ...]
    // Object: {"email": "department", ...}  (Odoo format)
    const parsed = JSON.parse(accountsJson);
    const accounts: GmailAccount[] = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([email, department]) => ({
          email,
          department: String(department),
        }));
    const supabase = getServiceClient();

    // Load history state from sync_state table
    const { data: syncStates } = await supabase
      .from("sync_state")
      .select("account, last_history_id");

    const historyState: Record<string, string> = {};
    for (const s of syncStates ?? []) {
      if (s.last_history_id) historyState[s.account] = s.last_history_id;
    }

    // Sync all accounts
    const result = await syncAllAccounts(
      serviceAccountJson,
      accounts,
      historyState,
      5
    );

    if (!result.emails.length) {
      return NextResponse.json({
        success: true,
        emails: 0,
        accounts_ok: result.successCount,
        accounts_failed: result.failedCount,
        message: result.failedCount > 0
          ? `Sin emails nuevos (${result.failedCount} cuentas fallaron)`
          : `Sin emails nuevos (${result.successCount} cuentas revisadas)`,
      });
    }

    // Save emails to Supabase (batch upsert)
    // Filter out emails with invalid dates to prevent RangeError on toISOString()
    const validEmails = result.emails.filter(e => {
      const d = new Date(e.date);
      return !isNaN(d.getTime());
    });
    const skippedDates = result.emails.length - validEmails.length;
    if (skippedDates > 0) {
      console.warn(`[sync-emails] Skipped ${skippedDates} emails with invalid dates`);
    }

    // 1. Build threads first so we know their ids before inserting emails.
    //    emails.thread_id (bigint FK → threads.id) MUST be populated at insert
    //    time — we learned the hard way that relying on gmail_thread_id alone
    //    leaves 400+ emails orphaned from their threads.
    const threadMap = new Map<string, typeof validEmails>();
    for (const e of validEmails) {
      const tid = e.gmail_thread_id;
      if (!threadMap.has(tid)) threadMap.set(tid, []);
      threadMap.get(tid)!.push(e);
    }

    const threads = [...threadMap.entries()].map(([tid, msgs]) => {
      msgs.sort((a, b) => a.date.localeCompare(b.date));
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      const hasInternal = msgs.some(m => m.sender_type === "internal");
      const hasExternal = msgs.some(m => m.sender_type === "external");
      const hoursNoResponse = last.sender_type === "external"
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
        status: hoursNoResponse > 48 ? "stalled" : hoursNoResponse > 24 ? "needs_response" : msgs.length === 1 ? "new" : "active",
        message_count: msgs.length,
        participant_emails: [...new Set(msgs.map(m => m.from_email))],
        has_internal_reply: hasInternal,
        has_external_reply: hasExternal,
        last_sender: last.from_email,
        last_sender_type: last.sender_type,
        hours_without_response: Math.round(hoursNoResponse * 10) / 10,
        account: first.account,
      };
    });

    // Upsert threads and capture ids in one round trip
    const threadIdByGmail = new Map<string, number>();
    if (threads.length) {
      const { data: upsertedThreads, error: threadErr } = await supabase
        .from("threads")
        .upsert(threads, { onConflict: "gmail_thread_id" })
        .select("id, gmail_thread_id");
      if (threadErr) {
        console.error("[sync-emails] thread upsert failed", threadErr);
      }
      for (const t of upsertedThreads ?? []) {
        threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
      }
    }

    // Fallback: any gmail_thread_ids not returned from the upsert (possible
    // with ignoreDuplicates-style races) — fetch them explicitly so emails
    // never land with null thread_id again.
    const missingThreadGmailIds = [...threadMap.keys()].filter(
      (tid) => !threadIdByGmail.has(tid),
    );
    if (missingThreadGmailIds.length) {
      const { data: fetched } = await supabase
        .from("threads")
        .select("id, gmail_thread_id")
        .in("gmail_thread_id", missingThreadGmailIds);
      for (const t of fetched ?? []) {
        threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
      }
    }

    // 2. Now insert emails with thread_id populated
    const emailBatches = chunkArray(validEmails.map(e => ({
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
    })), 50);

    let saved = 0;
    let emailsMissingThread = 0;
    for (const batch of emailBatches) {
      emailsMissingThread += batch.filter(b => b.thread_id === null).length;
      const { error } = await supabase
        .from("emails")
        .upsert(batch, { onConflict: "gmail_message_id", ignoreDuplicates: true });
      if (!error) saved += batch.length;
    }
    if (emailsMissingThread > 0) {
      console.warn(`[sync-emails] ${emailsMissingThread} emails inserted without thread_id — thread upsert likely failed`);
    }

    // Save history state with last_sync_at timestamp
    for (const [account, historyId] of Object.entries(result.newHistoryState)) {
      await supabase
        .from("sync_state")
        .upsert(
          { account, last_history_id: historyId, emails_synced: saved, last_sync_at: new Date().toISOString() },
          { onConflict: "account" }
        );
    }

    // Log to pipeline_logs for monitoring
    await supabase.from("pipeline_logs").insert({
      level: result.failedCount > 0 ? "warning" : "info",
      phase: "emails_synced",
      message: `Sync: ${saved} emails, ${threads.length} threads (${result.successCount} cuentas ok, ${result.failedCount} fallidas)`,
      details: {
        total: saved,
        threads: threads.length,
        accounts_ok: result.successCount,
        accounts_failed: result.failedCount,
      },
    });

    return NextResponse.json({
      success: true,
      emails: saved,
      threads: threads.length,
      accounts_ok: result.successCount,
      accounts_failed: result.failedCount,
    });
  } catch (err) {
    console.error("[sync-emails] Error:", err);
    return NextResponse.json(
      { error: "Error en sincronización de emails.", detail: String(err) },
      { status: 500 }
    );
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
