import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { syncAllAccounts, type GmailAccount } from "@/lib/pipeline/gmail";
import { persistEmailsAndThreads } from "@/lib/pipeline/email-persist";
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

    const persistResult = await persistEmailsAndThreads(supabase, validEmails);
    const saved = persistResult.emails_saved;
    const threads = { length: persistResult.threads_saved };

    // CRITICAL: only advance the Gmail history cursor if persistence worked.
    // Advancing it while every insert fails permanently skips those emails —
    // this is exactly how 2+ months of mail were lost (May 29 – Aug 5 2026,
    // broken BEFORE INSERT triggers made every upsert fail while the cursor
    // kept moving forward).
    const persistTotallyFailed = validEmails.length > 0 && saved === 0;
    if (!persistTotallyFailed) {
      for (const [account, historyId] of Object.entries(result.newHistoryState)) {
        await supabase
          .from("sync_state")
          .upsert(
            { account, last_history_id: historyId, emails_synced: saved, last_sync_at: new Date().toISOString() },
            { onConflict: "account" }
          );
      }
    }

    // Log to pipeline_logs for monitoring
    const persistFailed = persistResult.errors.length > 0;
    await supabase.from("pipeline_logs").insert({
      level: persistFailed ? "error" : result.failedCount > 0 ? "warning" : "info",
      phase: "emails_synced",
      message: persistFailed
        ? `Sync FALLÓ al guardar: ${saved}/${validEmails.length} emails (${persistResult.errors[0]})`
        : `Sync: ${saved} emails, ${threads.length} threads (${result.successCount} cuentas ok, ${result.failedCount} fallidas)`,
      details: {
        total: saved,
        fetched: validEmails.length,
        threads: threads.length,
        accounts_ok: result.successCount,
        accounts_failed: result.failedCount,
        persist_errors: persistResult.errors.slice(0, 3),
        history_cursor_advanced: !persistTotallyFailed,
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

