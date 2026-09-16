/**
 * sync-emails (Edge Function) — ingest incremental de Gmail, un buzón por
 * invocación. Reemplaza a /api/pipeline/sync-emails de Vercel.
 *
 * Disparo: pg_cron cada 30 min → una llamada pg_net por cuenta activa en
 * gmail_accounts (ver migración 20260916c). Así cada invocación queda muy por
 * debajo del límite de 2 s de CPU de Edge Functions y una cuenta lenta no
 * bloquea a las demás.
 *
 * Body: { "account": "info@quimibond.com" }  (o { "all": true } para las 52
 * en serie, solo para pruebas manuales).
 *
 * Cursor: sync_state.last_history_id por cuenta. Solo avanza si la
 * persistencia funcionó (lección del hueco may–ago 2026).
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody } from "../_shared/env.ts";
import { GmailClient, GmailApiError, loadServiceAccount, chunk, type ServiceAccount } from "../_shared/gmail.ts";
import { parseMessage, deduplicateEmails, hasValidDate, type ParsedEmail } from "../_shared/email-parse.ts";
import { persistEmailsAndThreads } from "../_shared/email-persist.ts";

const BOOTSTRAP_HOURS = 72;
const BOOTSTRAP_MAX = 100;
const FETCH_CONCURRENCY = 10;
const MAX_MESSAGES_PER_RUN = 300;

interface AccountResult {
  account: string;
  fetched: number;
  saved: number;
  inserted: number;
  updated: number;
  skipped: number;
  threads: number;
  cursor_advanced: boolean;
  bootstrap: boolean;
  error?: string;
}

async function fetchMessages(gmail: GmailClient, ids: string[], account: string): Promise<ParsedEmail[]> {
  const out: ParsedEmail[] = [];
  for (const c of chunk(ids, FETCH_CONCURRENCY)) {
    const results = await Promise.allSettled(c.map((id) => gmail.messageGet(id)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        const parsed = parseMessage(r.value, account);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function syncAccount(supabase: any, sa: ServiceAccount, account: string): Promise<AccountResult> {
  const res: AccountResult = {
    account,
    fetched: 0,
    saved: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    threads: 0,
    cursor_advanced: false,
    bootstrap: false,
  };
  const gmail = new GmailClient(sa, account);

  const { data: state } = await supabase.from("sync_state").select("last_history_id").eq("account", account).maybeSingle();
  let historyId: string | undefined = state?.last_history_id ?? undefined;
  let newHistoryId: string | null = null;
  let messageIds: string[] = [];

  if (historyId) {
    try {
      let pageToken: string | undefined;
      do {
        const h = await gmail.historyList(historyId, pageToken);
        newHistoryId = h.historyId ?? newHistoryId;
        for (const item of h.history ?? []) {
          for (const m of item.messagesAdded ?? []) if (m.message?.id) messageIds.push(m.message.id);
        }
        pageToken = h.nextPageToken;
      } while (pageToken && messageIds.length < MAX_MESSAGES_PER_RUN);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) {
        console.warn(`[sync-emails] history expired for ${account}, bootstrapping`);
        historyId = undefined;
      } else {
        throw err;
      }
    }
  }

  if (!historyId) {
    res.bootstrap = true;
    const after = Math.floor(Date.now() / 1000) - BOOTSTRAP_HOURS * 3600;
    const list = await gmail.messagesList(`after:${after}`, BOOTSTRAP_MAX);
    messageIds = (list.messages ?? []).map((m) => m.id);
    const profile = await gmail.getProfile();
    newHistoryId = profile.historyId ?? null;
  }

  messageIds = [...new Set(messageIds)].slice(0, MAX_MESSAGES_PER_RUN);

  let saved = 0;
  if (messageIds.length) {
    const emails = deduplicateEmails(await fetchMessages(gmail, messageIds, account)).filter(hasValidDate);
    res.fetched = emails.length;
    if (emails.length) {
      const p = await persistEmailsAndThreads(supabase, emails);
      saved = p.emails_saved;
      res.saved = p.emails_saved;
      res.inserted = p.emails_inserted;
      res.updated = p.emails_updated;
      res.skipped = p.emails_skipped;
      res.threads = p.threads_saved;
      if (p.errors.length) res.error = p.errors[0];
    }
  }

  // Cursor: solo avanza si no hubo fallo total de persistencia
  const persistTotallyFailed = res.fetched > 0 && saved === 0;
  if (newHistoryId && !persistTotallyFailed) {
    await supabase
      .from("sync_state")
      .upsert(
        { account, last_history_id: newHistoryId, emails_synced: saved, last_sync_at: new Date().toISOString() },
        { onConflict: "account" },
      );
    res.cursor_advanced = true;
  }
  return res;
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const sa = await loadServiceAccount(supabase);
  if (!sa) {
    await pipelineLog(supabase, "emails_synced", "error", "Sync: GOOGLE_SERVICE_ACCOUNT_JSON no configurado (env ni Vault)");
    return json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" }, 503);
  }

  const body = await readBody(req);
  let accounts: string[] = [];
  if (typeof body.account === "string" && body.account) {
    accounts = [body.account];
  } else if (body.all === true) {
    const { data } = await supabase.from("gmail_accounts").select("email").eq("active", true).order("email");
    accounts = (data ?? []).map((r: { email: string }) => r.email);
  } else {
    return json({ error: "body.account requerido (o all:true)" }, 400);
  }

  const started = Date.now();
  const results: AccountResult[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(supabase, sa, account));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync-emails] ${account}:`, message);
      results.push({
        account,
        fetched: 0,
        saved: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        threads: 0,
        cursor_advanced: false,
        bootstrap: false,
        error: message.slice(0, 300),
      });
    }
  }

  const totals = results.reduce(
    (t, r) => ({
      fetched: t.fetched + r.fetched,
      saved: t.saved + r.saved,
      inserted: t.inserted + r.inserted,
      updated: t.updated + r.updated,
      failed: t.failed + (r.error ? 1 : 0),
    }),
    { fetched: 0, saved: 0, inserted: 0, updated: 0, failed: 0 },
  );
  const elapsed = Math.round((Date.now() - started) / 1000);
  const label = accounts.length === 1 ? accounts[0] : `${accounts.length} cuentas`;
  await pipelineLog(
    supabase,
    "emails_synced",
    totals.failed > 0 ? "warning" : "info",
    `Sync ${label}: ${totals.saved} emails (${totals.inserted} nuevos, ${totals.updated} actualizados)${totals.failed ? `, ${totals.failed} con error` : ""} en ${elapsed}s`,
    { ...totals, accounts: accounts.length, elapsed_s: elapsed, errors: results.filter((r) => r.error).map((r) => `${r.account}: ${r.error}`).slice(0, 5) },
  );

  return json({ ok: true, ...totals, elapsed_s: elapsed, results });
});
