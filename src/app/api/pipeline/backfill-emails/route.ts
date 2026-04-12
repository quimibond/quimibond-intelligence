/**
 * Historical Gmail backfill endpoint.
 *
 * Pulls messages from Gmail using messages.list with a date-range query
 * (instead of the History API used by /api/pipeline/sync-emails, which only
 * returns deltas since the stored historyId).
 *
 * Designed to be called repeatedly with `pageToken` until `done: true`.
 * Each call processes up to one Gmail page (default 100 messages) so it
 * fits comfortably under Vercel's 300s budget even on body-fetch-heavy
 * accounts.
 *
 * Usage:
 *   POST /api/pipeline/backfill-emails?account=info@quimibond.com&since=2025-01-01
 *   POST /api/pipeline/backfill-emails?account=info@quimibond.com&since=2025-01-01&pageToken=XYZ
 *
 * Response:
 *   { ok, account, since, fetched, emails_saved, threads_saved, nextPageToken, done }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { fetchAccountEmailsByQuery, type GmailAccount } from "@/lib/pipeline/gmail";
import { persistEmailsAndThreads } from "@/lib/pipeline/email-persist";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const account = url.searchParams.get("account");
  const since = url.searchParams.get("since");
  const pageToken = url.searchParams.get("pageToken") ?? undefined;
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") ?? 100), 500);

  if (!account || !since) {
    return NextResponse.json(
      { error: "Missing required params: account, since (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json(
      { error: "since must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return NextResponse.json(
      { error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" },
      { status: 503 },
    );
  }

  const accountsJson = process.env.GMAIL_ACCOUNTS_JSON;
  if (!accountsJson) {
    return NextResponse.json(
      { error: "GMAIL_ACCOUNTS_JSON not configured" },
      { status: 503 },
    );
  }

  // Resolve department from configured accounts list
  const parsed = JSON.parse(accountsJson);
  const accounts: GmailAccount[] = Array.isArray(parsed)
    ? parsed
    : Object.entries(parsed).map(([email, department]) => ({
        email,
        department: String(department),
      }));
  const acct = accounts.find((a) => a.email === account);
  if (!acct) {
    return NextResponse.json(
      { error: `Account ${account} not in GMAIL_ACCOUNTS_JSON` },
      { status: 404 },
    );
  }

  // Gmail query: convert YYYY-MM-DD → YYYY/MM/DD (Gmail format)
  const query = `after:${since.replace(/-/g, "/")}`;

  try {
    const { emails, nextPageToken } = await fetchAccountEmailsByQuery(
      serviceAccountJson,
      acct,
      query,
      pageToken,
      pageSize,
    );

    const validEmails = emails.filter((e) => {
      const d = new Date(e.date);
      return !isNaN(d.getTime());
    });

    const supabase = getServiceClient();
    const persistResult = await persistEmailsAndThreads(supabase, validEmails);

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "emails_backfill",
      message: `Backfill ${account} since=${since}: ${persistResult.emails_saved} emails, ${persistResult.threads_saved} threads`,
      details: {
        account,
        since,
        pageToken: pageToken ?? null,
        nextPageToken,
        ...persistResult,
      },
    });

    return NextResponse.json({
      ok: true,
      account,
      since,
      fetched: emails.length,
      ...persistResult,
      nextPageToken,
      done: nextPageToken === null,
    });
  } catch (err) {
    console.error("[backfill-emails] failed", err);
    return NextResponse.json(
      { error: "Backfill failed", detail: String(err) },
      { status: 500 },
    );
  }
}
