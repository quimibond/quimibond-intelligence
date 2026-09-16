/**
 * Shared persistence for Gmail emails + threads (ingest v2, Memoria Fase 1).
 *
 * Used by both incremental sync and historical backfill. Centralizes two
 * invariants:
 *
 * 1. emails.thread_id (bigint FK to threads.id) MUST be populated at insert
 *    time so JOINs work. We learned this the hard way after 423 emails landed
 *    orphaned because the original sync-emails route inserted emails before
 *    threads existed.
 *
 * 2. Un correo ya guardado se ACTUALIZA solo si la versión de ingest entrante
 *    es mayor (RPC ingest_emails_v2). Así el backfill enriquece los 232k
 *    correos legacy (cuerpo truncado, sin HTML ni headers) sin pisar nada
 *    que ya esté completo, y sin que un re-fetch reescriba lo mismo.
 *
 * Además: sube el payload crudo de Gmail al bucket `email-raw` (best-effort,
 * nunca bloquea el guardado) y registra una fila en email_attachments por
 * adjunto, con el estado inicial de extracción según reglas de tipo/tamaño.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedEmail, ParsedAttachment } from "@/lib/pipeline/gmail";

export interface PersistResult {
  /** Correos que quedaron persistidos sin error (nuevos + actualizados + ya existentes). */
  emails_saved: number;
  emails_inserted: number;
  emails_updated: number;
  /** Ya estaban en la misma versión o superior: no se tocaron. */
  emails_skipped: number;
  threads_saved: number;
  emails_missing_thread: number;
  attachments_registered: number;
  raw_uploaded: number;
  /** DB error messages from failed batches — empty when everything persisted. */
  errors: string[];
}

const RAW_BUCKET = "email-raw";
const RAW_UPLOAD_CONCURRENCY = 8;
const RAW_MAX_BYTES = 45 * 1024 * 1024; // bucket cap 50 MB

/** Adjuntos que NO se descargan (se registran como skipped con motivo). */
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_MIN_BYTES = 100 * 1024;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Decide el estado inicial de extracción de un adjunto. Solo 'pending' se
 * descarga en /api/pipeline/attachments-extract.
 */
export function classifyAttachment(a: ParsedAttachment): { status: "pending" | "skipped"; reason: string | null } {
  const mime = (a.mimeType ?? "").toLowerCase();
  const name = (a.filename ?? "").toLowerCase();
  if (!a.attachmentId) return { status: "skipped", reason: "inline_no_attachment_id" };
  if (a.size > ATTACHMENT_MAX_BYTES) return { status: "skipped", reason: "size_limit" };
  if (mime.startsWith("image/")) {
    if (a.size < IMAGE_MIN_BYTES) return { status: "skipped", reason: "image_small" };
    // Imágenes grandes (fotos de reclamos de calidad): visión con Claude se
    // decide en Fase 3 cuando exista topic por hilo. Se guardan como skipped
    // para no bloquear la cola; cambiar a 'pending' cuando exista extractor.
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

async function uploadRawPayloads(
  supabase: SupabaseClient,
  emails: ParsedEmail[],
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (process.env.EMAIL_RAW_STORAGE === "0") return paths;

  const bucket = supabase.storage.from(RAW_BUCKET);
  for (const batch of chunk(emails, RAW_UPLOAD_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (e) => {
        if (!e.raw_payload || e.raw_size_bytes > RAW_MAX_BYTES) return;
        const path = `${e.account}/${e.gmail_message_id}.json`;
        try {
          const body = Buffer.from(JSON.stringify(e.raw_payload), "utf-8");
          const { error } = await bucket.upload(path, body, {
            contentType: "application/json",
            upsert: true,
          });
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

export async function persistEmailsAndThreads(
  supabase: SupabaseClient,
  validEmails: ParsedEmail[],
): Promise<PersistResult> {
  const empty: PersistResult = {
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
  if (!validEmails.length) return empty;

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

  // 3. Raw payload → Storage (best-effort, en paralelo, antes del insert para
  //    que la fila ya nazca con raw_storage_path).
  const rawPaths = await uploadRawPayloads(supabase, validEmails);

  // 4. Insert/update emails via RPC condicional por ingest_version
  const emailRows = validEmails.map((e) => ({
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

  const result: PersistResult = { ...empty, threads_saved: threadRows.length, raw_uploaded: rawPaths.size };
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

  if (result.emails_missing_thread > 0) {
    console.warn(
      `[email-persist] ${result.emails_missing_thread} emails inserted without thread_id — thread upsert likely failed`,
    );
  }

  // 5. Adjuntos: una fila por adjunto de los correos insertados/actualizados
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
      .upsert(batch, { onConflict: "email_id,filename,size_bytes", ignoreDuplicates: true });
    if (error) {
      console.error("[email-persist] email_attachments upsert failed", error);
      result.errors.push(`attachments: ${error.message}`);
    } else {
      result.attachments_registered += batch.length;
    }
  }

  return result;
}
