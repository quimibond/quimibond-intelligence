/**
 * backfill-sweep (Edge Function) — re-ingesta histórica de Gmail por cuenta.
 * Reemplaza a /api/pipeline/backfill-sweep de Vercel.
 *
 * Drena `email_backfill_state`: una página de Gmail (100 mensajes) por
 * invocación y cuenta, con cursor `page_token`. pg_cron la dispara cada 5 min
 * para cada cuenta con done=false; cuando la cola está vacía el job no lanza
 * nada. Con ingest_version=2 los correos viejos se ACTUALIZAN (cuerpo
 * completo, headers, adjuntos) en vez de ignorarse.
 *
 * Body: { "account": "info@quimibond.com" }  o  { "next": true } (toma la
 * cuenta pendiente más antigua).
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody } from "../_shared/env.ts";
import { GmailClient, loadServiceAccount, chunk } from "../_shared/gmail.ts";
import { parseMessage, deduplicateEmails, hasValidDate, type ParsedEmail } from "../_shared/email-parse.ts";
import { persistEmailsAndThreads } from "../_shared/email-persist.ts";

const PAGE_SIZE = 100;
const PAGES_PER_RUN = 2;
const FETCH_CONCURRENCY = 10;
const TIME_BUDGET_MS = 120_000;

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const body = await readBody(req);
  let query = supabase
    .from("email_backfill_state")
    .select("account, since, page_token, emails_saved, threads_saved, pages_processed")
    .eq("done", false);
  query = typeof body.account === "string" && body.account ? query.eq("account", body.account) : query.order("updated_at", { ascending: true });
  const { data: rows, error } = await query.limit(1);
  if (error) return json({ error: error.message }, 500);
  const row = rows?.[0];
  if (!row) return json({ ok: true, done: true, message: "Sin backfill pendiente" });

  const sa = await loadServiceAccount(supabase);
  if (!sa) return json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" }, 503);

  const gmail = new GmailClient(sa, row.account);
  const q = `after:${String(row.since).replace(/-/g, "/")}`;
  const started = Date.now();
  let pageToken: string | undefined = row.page_token ?? undefined;
  let saved = Number(row.emails_saved ?? 0);
  let threads = Number(row.threads_saved ?? 0);
  let pages = Number(row.pages_processed ?? 0);
  let done = false;
  let lastError: string | null = null;
  let savedThisRun = 0;

  for (let i = 0; i < PAGES_PER_RUN && Date.now() - started < TIME_BUDGET_MS; i++) {
    try {
      const list = await gmail.messagesList(q, PAGE_SIZE, pageToken);
      const ids = [...new Set((list.messages ?? []).map((m) => m.id))];
      const emails: ParsedEmail[] = [];
      for (const c of chunk(ids, FETCH_CONCURRENCY)) {
        const results = await Promise.allSettled(c.map((id) => gmail.messageGet(id)));
        for (const r of results) {
          if (r.status === "fulfilled") {
            const parsed = parseMessage(r.value, row.account);
            if (parsed) emails.push(parsed);
          }
        }
      }
      const valid = deduplicateEmails(emails).filter(hasValidDate);
      if (valid.length) {
        const p = await persistEmailsAndThreads(supabase, valid);
        if (p.errors.length) {
          lastError = p.errors[0];
          break; // no avanzar el cursor sobre correos que no se guardaron
        }
        saved += p.emails_saved;
        threads += p.threads_saved;
        savedThisRun += p.emails_saved;
      }
      pages++;
      pageToken = list.nextPageToken ?? undefined;
      if (!pageToken) {
        done = true;
        break;
      }
    } catch (err) {
      lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      break;
    }
  }

  await supabase
    .from("email_backfill_state")
    .update({
      page_token: done ? null : pageToken ?? null,
      emails_saved: saved,
      threads_saved: threads,
      pages_processed: pages,
      done,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq("account", row.account);

  const elapsed = Math.round((Date.now() - started) / 1000);
  await pipelineLog(
    supabase,
    "backfill_sweep",
    lastError ? "warning" : "info",
    `Backfill ${row.account}: ${savedThisRun} emails esta corrida (${saved} acumulados, ${pages} páginas)${done ? " — completo" : ""}${lastError ? ` — error: ${lastError}` : ""}`,
    { account: row.account, saved_run: savedThisRun, saved_total: saved, pages, done, elapsed_s: elapsed },
  );

  return json({ ok: true, account: row.account, saved_run: savedThisRun, saved_total: saved, pages, done, error: lastError, elapsed_s: elapsed });
});
