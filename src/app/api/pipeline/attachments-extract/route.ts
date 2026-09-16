/**
 * Extracción de adjuntos (Memoria Fase 1). Cron cada 15 min.
 *
 * Drena `email_attachments` con extract_status='pending':
 *   1. Descarga el archivo de Gmail (attachments.get). Si el attachmentId
 *      caducó (Gmail no los garantiza estables), re-lee el mensaje y lo
 *      re-localiza por nombre + tamaño.
 *   2. sha256 → si otro adjunto ya subió el mismo archivo, reutiliza su
 *      storage_path (el mismo PDF en 40 correos se guarda una vez).
 *   3. Sube al bucket privado `email-attachments/{sha256}.{ext}`.
 *   4. Extrae texto: PDF (pdf-parse), Excel/CSV (xlsx), Word (mammoth),
 *      texto plano. Queda en extracted_text para el chunking de Fase 2.
 *
 * Sin IA. Idempotente. Presupuesto de tiempo bajo maxDuration. Cada corrida
 * escribe a pipeline_logs (phase=attachments_extract) para el watchdog.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import * as XLSX from "xlsx";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

const BUCKET = "email-attachments";
const BATCH = 40;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 95_000;
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTEMPTS = 3;

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

function gmailFor(serviceAccountJson: string, userEmail: string) {
  const creds = JSON.parse(serviceAccountJson);
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    subject: userEmail,
  });
  return google.gmail({ version: "v1", auth });
}

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

type Kind = "pdf" | "sheet" | "docx" | "text" | "other";

function kindOf(filename: string, mime: string): Kind {
  const ext = extOf(filename, mime);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["xlsx", "xls", "xlsm", "csv", "tsv"].includes(ext) || /spreadsheetml|ms-excel|text\/csv/.test(mime)) return "sheet";
  if (ext === "docx" || /wordprocessingml/.test(mime)) return "docx";
  if (["txt", "md", "json", "log"].includes(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

async function extractText(kind: Kind, buffer: Buffer): Promise<string | null> {
  switch (kind) {
    case "pdf": {
      // Import directo del módulo interno: el index de pdf-parse@1 intenta
      // leer un PDF de prueba al cargarse cuando no hay module.parent.
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
        b: Buffer,
        o?: { max?: number },
      ) => Promise<{ text: string }>;
      const out = await pdfParse(buffer, { max: 200 });
      return out.text ?? "";
    }
    case "sheet": {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = [];
      for (const name of wb.SheetNames.slice(0, 10)) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
        if (csv.trim()) parts.push(`--- Hoja: ${name} ---\n${csv}`);
      }
      return parts.join("\n\n");
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer });
      return r.value ?? "";
    }
    case "text":
      return buffer.toString("utf-8");
    default:
      return null;
  }
}

async function downloadAttachment(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  row: PendingRow,
): Promise<{ buffer: Buffer; attachmentId: string } | null> {
  const tryGet = async (id: string) => {
    const res = await gmail.users.messages.attachments.get({ userId: "me", messageId, id });
    const data = res.data.data;
    return data ? Buffer.from(data, "base64url") : null;
  };

  if (row.gmail_attachment_id) {
    try {
      const buffer = await tryGet(row.gmail_attachment_id);
      if (buffer) return { buffer, attachmentId: row.gmail_attachment_id };
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code !== 400 && code !== 404) throw err;
      // attachmentId caducado → re-localizar abajo
    }
  }

  // Re-leer el mensaje y buscar la parte por nombre + tamaño
  const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const stack = [...(msg.data.payload?.parts ?? [])];
  while (stack.length) {
    const part = stack.pop()!;
    if (part.parts) stack.push(...part.parts);
    if (
      part.filename === row.filename &&
      Number(part.body?.size ?? 0) === row.size_bytes &&
      part.body?.attachmentId
    ) {
      const buffer = await tryGet(part.body.attachmentId);
      if (buffer) return { buffer, attachmentId: part.body.attachmentId };
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return NextResponse.json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" }, { status: 503 });
  }

  const supabase = getServiceClient();
  const started = Date.now();
  const stats = { done: 0, failed: 0, skipped: 0, reused: 0, bytes: 0 };

  try {
    const { data: pending, error } = await supabase
      .from("email_attachments")
      .select("id, email_id, gmail_attachment_id, filename, mime_type, size_bytes, attempts, emails!inner(account, gmail_message_id)")
      .eq("extract_status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);

    const rows = (pending ?? []) as unknown as PendingRow[];
    const gmailByAccount = new Map<string, ReturnType<typeof google.gmail>>();
    const bucket = supabase.storage.from(BUCKET);

    const processOne = async (row: PendingRow) => {
      const email = Array.isArray(row.emails) ? row.emails[0] : row.emails;
      if (!email) {
        await supabase
          .from("email_attachments")
          .update({ extract_status: "failed", last_error: "email sin cuenta", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        stats.failed++;
        return;
      }
      const kind = kindOf(row.filename, row.mime_type);
      try {
        let gmail = gmailByAccount.get(email.account);
        if (!gmail) {
          gmail = gmailFor(serviceAccountJson, email.account);
          gmailByAccount.set(email.account, gmail);
        }
        const dl = await downloadAttachment(gmail, email.gmail_message_id, row);
        if (!dl) {
          await supabase
            .from("email_attachments")
            .update({
              extract_status: "failed",
              attempts: row.attempts + 1,
              last_error: "adjunto no encontrado en Gmail",
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          stats.failed++;
          return;
        }

        const sha = createHash("sha256").update(dl.buffer).digest("hex");
        const ext = extOf(row.filename, row.mime_type);
        const path = `${sha}.${ext}`;

        // Dedup: ¿ya existe el archivo (mismo sha) subido por otro adjunto?
        const { data: twin } = await supabase
          .from("email_attachments")
          .select("storage_path, extracted_text, extract_status")
          .eq("sha256", sha)
          .not("storage_path", "is", null)
          .neq("id", row.id)
          .limit(1)
          .maybeSingle();

        let storagePath = twin?.storage_path as string | undefined;
        let text: string | null | undefined = twin?.extract_status === "done" ? (twin.extracted_text as string | null) : undefined;

        if (!storagePath) {
          const { error: upErr } = await bucket.upload(path, dl.buffer, {
            contentType: row.mime_type || "application/octet-stream",
            upsert: true,
          });
          if (upErr) throw new Error(`storage: ${upErr.message}`);
          storagePath = path;
          stats.bytes += dl.buffer.length;
        } else {
          stats.reused++;
        }

        if (text === undefined) {
          text = await extractText(kind, dl.buffer);
        }

        const noExtractor = kind === "other";
        await supabase
          .from("email_attachments")
          .update({
            gmail_attachment_id: dl.attachmentId,
            sha256: sha,
            storage_path: storagePath,
            extracted_text: text ? text.slice(0, MAX_TEXT_CHARS) : null,
            extract_status: noExtractor ? "skipped" : "done",
            skip_reason: noExtractor ? "no_extractor" : null,
            attempts: row.attempts + 1,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (noExtractor) stats.skipped++;
        else stats.done++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[attachments-extract] ${row.filename} (email ${row.email_id}):`, message);
        const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
        await supabase
          .from("email_attachments")
          .update({
            extract_status: exhausted ? "failed" : "pending",
            attempts: row.attempts + 1,
            last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (exhausted) stats.failed++;
      }
    };

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(processOne));
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    await supabase.from("pipeline_logs").insert({
      level: stats.failed > 0 ? "warning" : "info",
      phase: "attachments_extract",
      message: `Adjuntos: ${stats.done} extraídos, ${stats.reused} reutilizados, ${stats.skipped} sin extractor, ${stats.failed} fallidos (${rows.length} en cola, ${elapsed}s)`,
      details: { ...stats, queued: rows.length, elapsed_s: elapsed },
    });

    return NextResponse.json({ ok: true, ...stats, queued: rows.length, elapsed_s: elapsed });
  } catch (err) {
    console.error("[attachments-extract] error:", err);
    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "attachments_extract",
      message: `Adjuntos: error fatal ${String(err).slice(0, 200)}`,
      details: { ...stats },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
