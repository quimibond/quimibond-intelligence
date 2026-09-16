/**
 * Parser de mensajes de Gmail (format=full) → ParsedEmail. Port a Deno del
 * ingest v2 de src/lib/pipeline/gmail.ts (Memoria Fase 1): cuerpo completo,
 * HTML, headers de threading, cc/bcc, labels, payload crudo y body_clean.
 */
import { htmlToText, legacyBody, stripQuotedText } from "./email-clean.ts";
import { decodeBase64UrlText } from "./gmail.ts";

export const INGEST_VERSION = 2;
const MAX_HTML_CHARS = 1_000_000;
const INTERNAL_DOMAINS = ["quimibond.com", "quimibond.com.mx"];

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
}

export interface ParsedEmail {
  account: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  from: string;
  from_email: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  subject_normalized: string;
  date: string;
  body: string;
  body_full: string;
  body_html: string | null;
  body_clean: string;
  snippet: string;
  attachments: ParsedAttachment[];
  has_attachments: boolean;
  is_reply: boolean;
  sender_type: "internal" | "external";
  message_id_hdr: string | null;
  in_reply_to_hdr: string | null;
  references_hdr: string[];
  labels: string[];
  raw_payload: unknown;
  raw_size_bytes: number;
  ingest_version: number;
}

export function normalizeSubject(subject: string): string {
  return subject.replace(/^(re|fwd|fw|rv):\s*/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

export function isInternal(email: string): boolean {
  return INTERNAL_DOMAINS.some((d) => email.endsWith(`@${d}`));
}

interface MimePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
}

export function collectBodies(payload: MimePart): { plain: string | null; html: string | null } {
  const out: { plain: string | null; html: string | null } = { plain: null, html: null };
  const walk = (part: MimePart) => {
    if (!part) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    const isAttachment = Boolean(part.filename) && part.filename !== "";
    if (!isAttachment && part.body?.data) {
      if (mime === "text/plain" && out.plain === null) out.plain = part.body.data;
      else if (mime === "text/html" && out.html === null) out.html = part.body.data;
    }
    for (const child of part.parts ?? []) {
      if (out.plain !== null && out.html !== null) return;
      walk(child);
    }
  };
  walk(payload);
  return out;
}

export function extractAttachments(parts: MimePart[]): ParsedAttachment[] {
  const attachments: ParsedAttachment[] = [];
  for (const part of parts) {
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId,
      });
    }
    if (part.parts) attachments.push(...extractAttachments(part.parts));
  }
  return attachments;
}

// deno-lint-ignore no-explicit-any
export function parseMessage(msg: any, account: string): ParsedEmail | null {
  if (!msg?.id || !msg.payload) return null;

  const headers: { name?: string; value?: string }[] = msg.payload.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const from = getHeader("From");
  const fromEmail = extractEmail(from);
  const subject = getHeader("Subject") || "(sin asunto)";
  const inReplyTo = getHeader("In-Reply-To") || null;
  const references = getHeader("References").split(/\s+/).map((r) => r.trim()).filter(Boolean);

  const bodies = collectBodies(msg.payload);
  const plainRaw = bodies.plain ? decodeBase64UrlText(bodies.plain) : "";
  const html = bodies.html ? decodeBase64UrlText(bodies.html) : "";
  const bodyFull = (plainRaw.trim() ? plainRaw : htmlToText(html)).replace(/\r\n?/g, "\n").trim();
  const bodyClean = stripQuotedText(bodyFull);
  const attachments = extractAttachments(msg.payload.parts ?? []);
  const rawJson = JSON.stringify(msg);

  return {
    account,
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId ?? msg.id,
    from,
    from_email: fromEmail,
    to: getHeader("To"),
    cc: getHeader("Cc"),
    bcc: getHeader("Bcc"),
    subject,
    subject_normalized: normalizeSubject(subject),
    date: getHeader("Date"),
    body: legacyBody(bodyFull, 5000),
    body_full: bodyFull,
    body_html: html ? html.slice(0, MAX_HTML_CHARS) : null,
    body_clean: bodyClean,
    snippet: (msg.snippet ?? "").slice(0, 500),
    attachments,
    has_attachments: attachments.length > 0,
    is_reply: /^(re|rv):/i.test(subject) || Boolean(inReplyTo),
    sender_type: isInternal(fromEmail) ? "internal" : "external",
    message_id_hdr: getHeader("Message-ID") || getHeader("Message-Id") || null,
    in_reply_to_hdr: inReplyTo,
    references_hdr: references,
    labels: Array.isArray(msg.labelIds) ? msg.labelIds.map(String) : [],
    raw_payload: msg,
    raw_size_bytes: new TextEncoder().encode(rawJson).length,
    ingest_version: INGEST_VERSION,
  };
}

/** Dedup por huella (remitente | asunto normalizado | minuto). */
export function deduplicateEmails(emails: ParsedEmail[]): ParsedEmail[] {
  const seen = new Set<string>();
  return emails.filter((e) => {
    const dateMinute = (e.date ?? "").replace(/:\d{2}\s/, " ").slice(0, 16);
    const fp = `${e.from_email}|${e.subject_normalized}|${dateMinute}`;
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

export function hasValidDate(e: ParsedEmail): boolean {
  return !isNaN(new Date(e.date).getTime());
}
