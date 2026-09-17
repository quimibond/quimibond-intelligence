/**
 * Persistencia compartida de correos + hilos (ingest v2). Port a Deno de
 * src/lib/pipeline/email-persist.ts. Invariantes:
 *  1. emails.thread_id se resuelve ANTES de insertar (hilos primero).
 *  2. Un correo existente se actualiza solo si la versión entrante es mayor
 *     (RPC ingest_emails_v2).
 *  3. El payload crudo se sube a Storage best-effort; nunca bloquea.
 *  4. Una fila en email_attachments por adjunto, con estado inicial.
 */
import type { ParsedAttachment, ParsedEmail } from "./email-parse.ts";
import { chunk } from "./gmail.ts";

export interface PersistResult {
  emails_saved: number;
  emails_inserted: number;
  emails_updated: number;
  emails_skipped: number;
  threads_saved: number;
  emails_missing_thread: number;
  attachments_registered: number;
  raw_uploaded: number;
  errors: string[];
}

const RAW_BUCKET = "email-raw";
const RAW_UPLOAD_CONCURRENCY = 8;
const RAW_MAX_BYTES = 45 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_MIN_BYTES = 100 * 1024;

export function classifyAttachment(a: ParsedAttachment): { status: "pending" | "skipped"; reason: string | null } {
  const mime = (a.mimeType ?? "").toLowerCase();
  const name = (a.filename ?? "").toLowerCase();
  if (!a.attachmentId) return { status: "skipped", reason: "inline_no_attachment_id" };
  if (a.size > ATTACHMENT_MAX_BYTES) return { status: "skipped", reason: "size_limit" };
  if (mime.startsWith("image/")) {
    if (a.size < IMAGE_MIN_BYTES) return { status: "skipped", reason: "image_small" };
    return { status: "skipped", reason: "image_vision_phase3" };
  }
  if (mime === "text/xml" || mime === "application/xml" || name.endsWith(".xml")) {
    return { status: "skipped", reason: "cfdi_xml" };
  }
  if (name.endsWith(".p7s") || name.endsWith(".ics") || name.endsWith(".vcf") || mime === "application/pkcs7-signature") {
    return { status: "skipped", reason: "signature_or_calendar" };
  }
  return { status: "pending", reason: null };
}

// deno-lint-ignore no-explicit-any
type Client = any;

async function uploadRawPayloads(supabase: Client, emails: ParsedEmail[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (Deno.env.get("EMAIL_RAW_STORAGE") === "0") return paths;
  const bucket = supabase.storage.from(RAW_BUCKET);
  for (const batch of chunk(emails, RAW_UPLOAD_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (e) => {
        if (!e.raw_payload || e.raw_size_bytes > RAW_MAX_BYTES) return;
        const path = `${e.account}/${e.gmail_message_id}.json`;
        try {
          const body = new TextEncoder().encode(JSON.stringify(e.raw_payload));
          const { error } = await bucket.upload(path, body, { contentType: "application/json", upsert: true });
          if (error) {
            console.warn(`[email-persist] raw upload failed ${path}: ${error.message}`);
            return;
          }
          paths.set(e.gmail_message_id, path);
        } catch (err) {
          console.warn(`[email-persist] raw upload threw ${path}:`, err);
        }
      }),
    );
  }
  return paths;
}


/** Postgres no acepta `\u0000` ni surrogates sueltos dentro de json/jsonb y
 * PostgREST responde PGRST102 "Empty or invalid json" para todo el lote. Un
 * solo correo con un NUL en el cuerpo (HTML roto, adjunto inline) atoraba el
 * backfill de un buzón entero en la misma página. Se limpian todas las cadenas
 * del payload antes de mandarlo. */
export function sanitizeJson<T>(value: T): T {
  if (typeof value === "string") {
    // deno-lint-ignore no-control-regex
    return value.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") as T;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeJson(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeJson(v);
    return out as T;
  }
  return value;
}

export async function persistEmailsAndThreads(supabase: Client, validEmails: ParsedEmail[]): Promise<PersistResult> {
  const result: PersistResult = {
    emails_saved: 0,
    emails_inserted: 0,
    emails_updated: 0,
    emails_skipped: 0,
    threads_saved: 0,
    emails_missing_thread: 0,
    attachments_registered: 0,
    raw_uploaded: 0,
    errors: [],
  };
  if (!validEmails.length) return result;

  // 1. Hilos
  const threadMap = new Map<string, ParsedEmail[]>();
  for (const e of validEmails) {
    if (!threadMap.has(e.gmail_thread_id)) threadMap.set(e.gmail_thread_id, []);
    threadMap.get(e.gmail_thread_id)!.push(e);
  }
  const threadRows = [...threadMap.entries()].map(([tid, msgs]) => {
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    const hoursNoResponse = last.sender_type === "external" ? (Date.now() - new Date(last.date).getTime()) / 3600000 : 0;
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
      participant_emails: [...new Set(msgs.map((m) => m.from_email))],
      has_internal_reply: msgs.some((m) => m.sender_type === "internal"),
      has_external_reply: msgs.some((m) => m.sender_type === "external"),
      last_sender: last.from_email,
      last_sender_type: last.sender_type,
      hours_without_response: Math.round(hoursNoResponse * 10) / 10,
      account: first.account,
    };
  });
  result.threads_saved = threadRows.length;

  const threadIdByGmail = new Map<string, number>();
  if (threadRows.length) {
    const { data: upserted, error: threadErr } = await supabase
      .from("threads")
      .upsert(sanitizeJson(threadRows), { onConflict: "gmail_thread_id" })
      .select("id, gmail_thread_id");
    if (threadErr) console.error("[email-persist] thread upsert failed", threadErr);
    for (const t of upserted ?? []) threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
  }
  const missing = [...threadMap.keys()].filter((tid) => !threadIdByGmail.has(tid));
  if (missing.length) {
    const { data: fetched } = await supabase.from("threads").select("id, gmail_thread_id").in("gmail_thread_id", missing);
    for (const t of fetched ?? []) threadIdByGmail.set(t.gmail_thread_id as string, t.id as number);
  }

  // 2. Raw → Storage
  const rawPaths = await uploadRawPayloads(supabase, validEmails);
  result.raw_uploaded = rawPaths.size;

  // 3. Correos via RPC condicional
  const emailRows = validEmails.map((e) => sanitizeJson({
    account: e.account,
    sender: e.from,
    recipient: e.to,
    cc: e.cc || null,
    bcc: e.bcc || null,
    subject: e.subject,
    body: e.body,
    body_full: e.body_full,
    body_html: e.body_html,
    body_clean: e.body_clean,
    snippet: e.snippet,
    email_date: new Date(e.date).toISOString(),
    gmail_message_id: e.gmail_message_id,
    gmail_thread_id: e.gmail_thread_id,
    thread_id: threadIdByGmail.get(e.gmail_thread_id) ?? null,
    attachments: e.attachments.length ? e.attachments : null,
    is_reply: e.is_reply,
    sender_type: e.sender_type,
    has_attachments: e.has_attachments,
    message_id_hdr: e.message_id_hdr,
    in_reply_to_hdr: e.in_reply_to_hdr,
    references_hdr: e.references_hdr.length ? e.references_hdr : null,
    labels: e.labels.length ? e.labels : null,
    raw_storage_path: rawPaths.get(e.gmail_message_id) ?? null,
    raw_size_bytes: rawPaths.has(e.gmail_message_id) ? e.raw_size_bytes : null,
    ingest_version: e.ingest_version,
  }));

  const idByGmail = new Map<string, number>();
  for (const batch of chunk(emailRows, 50)) {
    result.emails_missing_thread += batch.filter((b) => b.thread_id === null).length;
    const { data, error } = await supabase.rpc("ingest_emails_v2", { p_rows: batch });
    if (error) {
      console.error("[email-persist] ingest_emails_v2 batch failed", error);
      result.errors.push(error.message);
      continue;
    }
    const rows = (data ?? []) as { id: number; gmail_message_id: string; action: string }[];
    for (const r of rows) {
      idByGmail.set(r.gmail_message_id, r.id);
      if (r.action === "inserted") result.emails_inserted++;
      else result.emails_updated++;
    }
    result.emails_skipped += batch.length - rows.length;
    result.emails_saved += batch.length;
  }

  // 4. Adjuntos
  const attachmentRows: Record<string, unknown>[] = [];
  for (const e of validEmails) {
    const emailId = idByGmail.get(e.gmail_message_id);
    if (!emailId) continue;
    for (const a of e.attachments) {
      const cls = classifyAttachment(a);
      attachmentRows.push({
        email_id: emailId,
        gmail_attachment_id: a.attachmentId ?? null,
        filename: a.filename,
        mime_type: a.mimeType || "application/octet-stream",
        size_bytes: a.size ?? 0,
        extract_status: cls.status,
        skip_reason: cls.reason,
      });
    }
  }
  for (const batch of chunk(attachmentRows, 200)) {
    const { error } = await supabase
      .from("email_attachments")
      .upsert(sanitizeJson(batch), { onConflict: "email_id,filename,size_bytes", ignoreDuplicates: true });
    if (error) {
      console.error("[email-persist] email_attachments upsert failed", error);
      result.errors.push(`attachments: ${error.message}`);
    } else {
      result.attachments_registered += batch.length;
    }
  }

  return result;
}
