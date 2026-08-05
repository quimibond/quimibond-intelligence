/**
 * Self-driving historical Gmail backfill.
 *
 * Drains the `email_backfill_state` queue: one row per account with a
 * `since` date and a Gmail pagination cursor. Each invocation processes as
 * many pages as fit in the time budget, persists progress, and exits. When
 * every row is done it becomes a cheap no-op (single SELECT), so it's safe
 * to run on a recurring cron.
 *
 * To start a backfill, seed the queue (SQL):
 *   INSERT INTO email_backfill_state (account, since)
 *   SELECT account, '2026-05-28' FROM sync_state
 *   ON CONFLICT (account) DO NOTHING;
 *
 * Created 2026-08-05 to recover the May 29 – Aug 5 gap caused by broken
 * BEFORE INSERT triggers on `emails` (every insert failed while the sync's
 * history cursor kept advancing).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { fetchAccountEmailsByQuery, type GmailAccount } from "@/lib/pipeline/gmail";
import { persistEmailsAndThreads } from "@/lib/pipeline/email-persist";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

const TIME_BUDGET_MS = 230_000; // leave headroom under the 300s limit
const PAGE_SIZE = 100;

interface BackfillRow {
  account: string;
  since: string;
  page_token: string | null;
  emails_saved: number;
  threads_saved: number;
  pages_processed: number;
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  const { data: pending, error: stateErr } = await supabase
    .from("email_backfill_state")
    .select("account, since, page_token, emails_saved, threads_saved, pages_processed")
    .eq("done", false)
    .order("account");

  if (stateErr) {
    return NextResponse.json(
      { error: "Cannot read email_backfill_state", detail: stateErr.message },
      { status: 500 },
    );
  }

  if (!pending?.length) {
    return NextResponse.json({ ok: true, done: true, message: "No pending backfill" });
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const accountsJson = process.env.GMAIL_ACCOUNTS_JSON;
  if (!serviceAccountJson || !accountsJson) {
    return NextResponse.json(
      { error: "GOOGLE_SERVICE_ACCOUNT_JSON / GMAIL_ACCOUNTS_JSON not configured" },
      { status: 503 },
    );
  }

  const parsed = JSON.parse(accountsJson);
  const accounts: GmailAccount[] = Array.isArray(parsed)
    ? parsed
    : Object.entries(parsed).map(([email, department]) => ({
        email,
        department: String(department),
      }));
  const accountByEmail = new Map(accounts.map((a) => [a.email, a]));

  const start = Date.now();
  let totalSaved = 0;
  let pagesThisRun = 0;
  const touched: string[] = [];

  for (const row of pending as BackfillRow[]) {
    if (Date.now() - start > TIME_BUDGET_MS) break;

    const acct = accountByEmail.get(row.account);
    if (!acct) {
      // Account no longer configured — mark done so the queue can drain.
      await supabase
        .from("email_backfill_state")
        .update({ done: true, last_error: "account not in GMAIL_ACCOUNTS_JSON", updated_at: new Date().toISOString() })
        .eq("account", row.account);
      continue;
    }

    const query = `after:${row.since.replace(/-/g, "/")}`;
    let pageToken: string | undefined = row.page_token ?? undefined;
    let saved = row.emails_saved;
    let threads = row.threads_saved;
    let pages = row.pages_processed;
    touched.push(row.account);

    while (Date.now() - start <= TIME_BUDGET_MS) {
      try {
        const { emails, nextPageToken } = await fetchAccountEmailsByQuery(
          serviceAccountJson,
          acct,
          query,
          pageToken,
          PAGE_SIZE,
        );

        const validEmails = emails.filter((e) => !isNaN(new Date(e.date).getTime()));
        const persistResult = await persistEmailsAndThreads(supabase, validEmails);

        if (persistResult.errors.length > 0) {
          // Don't advance the cursor past emails that failed to persist.
          await supabase
            .from("email_backfill_state")
            .update({ last_error: persistResult.errors[0], updated_at: new Date().toISOString() })
            .eq("account", row.account);
          break;
        }

        saved += persistResult.emails_saved;
        threads += persistResult.threads_saved;
        totalSaved += persistResult.emails_saved;
        pages += 1;
        pagesThisRun += 1;

        const isDone = nextPageToken === null;
        await supabase
          .from("email_backfill_state")
          .update({
            page_token: nextPageToken,
            done: isDone,
            emails_saved: saved,
            threads_saved: threads,
            pages_processed: pages,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("account", row.account);

        if (isDone) break;
        pageToken = nextPageToken;
      } catch (err) {
        console.error(`[backfill-sweep] ${row.account} failed`, err);
        await supabase
          .from("email_backfill_state")
          .update({ last_error: String(err), updated_at: new Date().toISOString() })
          .eq("account", row.account);
        break; // move on to the next account; retried on the next sweep
      }
    }
  }

  const { count: remaining } = await supabase
    .from("email_backfill_state")
    .select("account", { count: "exact", head: true })
    .eq("done", false);

  if (pagesThisRun > 0) {
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "emails_backfill",
      message: `Backfill sweep: ${totalSaved} emails en ${pagesThisRun} páginas (${touched.length} cuentas, ${remaining ?? 0} pendientes)`,
      details: { emails_saved: totalSaved, pages: pagesThisRun, accounts: touched, remaining },
    });
  }

  return NextResponse.json({
    ok: true,
    emails_saved: totalSaved,
    pages: pagesThisRun,
    accounts_touched: touched,
    remaining_accounts: remaining ?? 0,
    done: (remaining ?? 0) === 0,
  });
}
