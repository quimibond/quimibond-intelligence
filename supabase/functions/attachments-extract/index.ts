/**
 * attachments-extract (Edge Function) — baja adjuntos pendientes de Gmail,
 * los deduplica por sha256 en el bucket `email-attachments` y extrae texto
 * (Excel/CSV con xlsx, Word con mammoth, PDF con unpdf, texto plano).
 * Reemplaza a /api/pipeline/attachments-extract de Vercel.
 *
 * Límite de 2 s de CPU por invocación: se procesan pocos archivos por corrida
 * (pg_cron cada 2 min) y `attempts` se incrementa ANTES de procesar, así un
 * archivo que agota la CPU no se reintenta para siempre (3 intentos → failed).
 */
import { serviceClient, authorizeCron, json, pipelineLog } from "../_shared/env.ts";
import { GmailClient, GmailApiError, loadServiceAccount, decodeBase64Url } from "../_shared/gmail.ts";

const BUCKET = "email-attachments";
const BATCH = 6;
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTEMPTS = 3;
const PDF_MAX_BYTES = 4 * 1024 * 1024;
const PDF_MAX_PAGES = 40;

interface PendingRow {
  id: number;
  email_id: number;
  gmail_attachment_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  attempts: number;
  emails: { account: string; gmail_message_id: string } | { account: string; gmail_message_id: string }[] | null;
}

type Kind = "pdf" | "sheet" | "docx" | "text" | "other";

function extOf(filename: string, mime: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  if (m) return m[1];
  if (mime === "application/pdf") return "pdf";
  if (/spreadsheetml/.test(mime)) return "xlsx";
  if (/ms-excel/.test(mime)) return "xls";
  if (/wordprocessingml/.test(mime)) return "docx";
  if (mime === "text/csv") return "csv";
  if (mime === "text/plain") return "txt";
  return "bin";
}

function kindOf(filename: string, mime: string): Kind {
  const ext = extOf(filename, mime);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["xlsx", "xls", "xlsm", "csv", "tsv"].includes(ext) || /spreadsheetml|ms-excel|text\/csv/.test(mime)) return "sheet";
  if (ext === "docx" || /wordprocessingml/.test(mime)) return "docx";
  if (["txt", "md", "json", "log"].includes(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function extractText(kind: Kind, bytes: Uint8Array): Promise<string | null> {
  switch (kind) {
    case "pdf": {
      if (bytes.length > PDF_MAX_BYTES) return null;
      const { extractText: pdfText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await pdfText(pdf, { mergePages: false });
      return (text as string[]).slice(0, PDF_MAX_PAGES).join("\n");
    }
    case "sheet": {
      const XLSX = await import("npm:xlsx@0.18.5");
      const wb = XLSX.read(bytes, { type: "array" });
      const parts: string[] = [];
      for (const name of wb.SheetNames.slice(0, 10)) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
        if (csv.trim()) parts.push(`--- Hoja: ${name} ---\n${csv}`);
      }
      return parts.join("\n\n");
    }
    case "docx": {
      const mammoth = await import("npm:mammoth@1.8.0");
      const r = await mammoth.extractRawText({ arrayBuffer: bytes.buffer as ArrayBuffer });
      return r.value ?? "";
    }
    case "text":
      return new TextDecoder("utf-8").decode(bytes);
    default:
      return null;
  }
}

async function download(gmail: GmailClient, messageId: string, row: PendingRow): Promise<{ bytes: Uint8Array; attachmentId: string } | null> {
  const tryGet = async (id: string) => {
    const r = await gmail.attachmentGet(messageId, id);
    return r.data ? decodeBase64Url(r.data) : null;
  };
  if (row.gmail_attachment_id) {
    try {
      const bytes = await tryGet(row.gmail_attachment_id);
      if (bytes) return { bytes, attachmentId: row.gmail_attachment_id };
    } catch (err) {
      if (!(err instanceof GmailApiError) || (err.status !== 400 && err.status !== 404)) throw err;
    }
  }
  // attachmentId caducado: re-localizar por nombre + tamaño
  const msg = await gmail.messageGet(messageId);
  // deno-lint-ignore no-explicit-any
  const stack: any[] = [...(msg.payload?.parts ?? [])];
  while (stack.length) {
    const part = stack.pop();
    if (part.parts) stack.push(...part.parts);
    if (part.filename === row.filename && Number(part.body?.size ?? 0) === row.size_bytes && part.body?.attachmentId) {
      const bytes = await tryGet(part.body.attachmentId);
      if (bytes) return { bytes, attachmentId: part.body.attachmentId };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const sa = await loadServiceAccount(supabase);
  if (!sa) return json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" }, 503);

  const started = Date.now();
  const stats = { done: 0, failed: 0, skipped: 0, reused: 0, bytes: 0 };

  const { data: pending, error } = await supabase
    .from("email_attachments")
    .select("id, email_id, gmail_attachment_id, filename, mime_type, size_bytes, attempts, emails!inner(account, gmail_message_id)")
    .eq("extract_status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  const rows = (pending ?? []) as unknown as PendingRow[];
  if (!rows.length) return json({ ok: true, queued: 0, message: "Sin adjuntos pendientes" });

  const bucket = supabase.storage.from(BUCKET);
  const clients = new Map<string, GmailClient>();

  for (const row of rows) {
    const email = Array.isArray(row.emails) ? row.emails[0] : row.emails;
    const now = new Date().toISOString();
    // attempts++ antes de procesar: si la CPU nos mata a medio archivo, no se repite eternamente
    await supabase.from("email_attachments").update({ attempts: row.attempts + 1, updated_at: now }).eq("id", row.id);
    const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
    if (!email) {
      await supabase.from("email_attachments").update({ extract_status: "failed", last_error: "email sin cuenta" }).eq("id", row.id);
      stats.failed++;
      continue;
    }
    try {
      let gmail = clients.get(email.account);
      if (!gmail) {
        gmail = new GmailClient(sa, email.account);
        clients.set(email.account, gmail);
      }
      const dl = await download(gmail, email.gmail_message_id, row);
      if (!dl) {
        await supabase
          .from("email_attachments")
          .update({ extract_status: "failed", last_error: "adjunto no encontrado en Gmail", updated_at: now })
          .eq("id", row.id);
        stats.failed++;
        continue;
      }
      const sha = await sha256Hex(dl.bytes);
      const path = `${sha}.${extOf(row.filename, row.mime_type)}`;
      const { data: twin } = await supabase
        .from("email_attachments")
        .select("storage_path, extracted_text, extract_status")
        .eq("sha256", sha)
        .not("storage_path", "is", null)
        .neq("id", row.id)
        .limit(1)
        .maybeSingle();

      let storagePath: string | undefined = twin?.storage_path ?? undefined;
      let text: string | null | undefined = twin?.extract_status === "done" ? (twin.extracted_text as string | null) : undefined;
      if (!storagePath) {
        const { error: upErr } = await bucket.upload(path, dl.bytes, { contentType: row.mime_type || "application/octet-stream", upsert: true });
        if (upErr) throw new Error(`storage: ${upErr.message}`);
        storagePath = path;
        stats.bytes += dl.bytes.length;
      } else {
        stats.reused++;
      }
      const kind = kindOf(row.filename, row.mime_type);
      if (text === undefined) text = await extractText(kind, dl.bytes);
      const noExtractor = kind === "other" || (kind === "pdf" && text === null);
      await supabase
        .from("email_attachments")
        .update({
          gmail_attachment_id: dl.attachmentId,
          sha256: sha,
          storage_path: storagePath,
          extracted_text: text ? text.slice(0, MAX_TEXT_CHARS) : null,
          extract_status: noExtractor ? "skipped" : "done",
          skip_reason: noExtractor ? (kind === "pdf" ? "pdf_too_large" : "no_extractor") : null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (noExtractor) stats.skipped++;
      else stats.done++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[attachments-extract] ${row.filename} (email ${row.email_id}):`, message);
      await supabase
        .from("email_attachments")
        .update({ extract_status: exhausted ? "failed" : "pending", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (exhausted) stats.failed++;
    }
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  await pipelineLog(
    supabase,
    "attachments_extract",
    stats.failed > 0 ? "warning" : "info",
    `Adjuntos: ${stats.done} extraídos, ${stats.reused} reutilizados, ${stats.skipped} sin extractor, ${stats.failed} fallidos (${rows.length} en lote, ${elapsed}s)`,
    { ...stats, queued: rows.length, elapsed_s: elapsed },
  );
  return json({ ok: true, ...stats, queued: rows.length, elapsed_s: elapsed });
});
