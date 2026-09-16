/**
 * Gmail Service — Fetches emails via Gmail API with Service Account.
 * Port of qb19's gmail_service.py to TypeScript.
 */
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { htmlToText, stripQuotedText, legacyBody } from "@/lib/pipeline/email-clean";

/** Versión del ingest que producen estas funciones (emails.ingest_version). */
export const INGEST_VERSION = 2;
const MAX_HTML_CHARS = 1_000_000;

interface GmailAccount {
  email: string;
  department: string;
}

interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
}

interface ParsedEmail {
  account: string;
  department: string;
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
  /** LEGACY: texto colapsado a una línea y cortado a 5,000 chars (compat con consumidores viejos). */
  body: string;
  /** Texto plano completo con saltos de línea. */
  body_full: string;
  /** HTML original si el mensaje lo trae (cap 1 MB). */
  body_html: string | null;
  /** Solo el mensaje nuevo: sin citas, firma ni banners. */
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
  /** Payload completo de Gmail (format=full) para guardar en Storage. */
  raw_payload: unknown;
  raw_size_bytes: number;
  ingest_version: number;
}

const INTERNAL_DOMAINS = ["quimibond.com", "quimibond.com.mx"];
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function getAuthClient(serviceAccountJson: string, userEmail: string): JWT {
  const creds = JSON.parse(serviceAccountJson);
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
    subject: userEmail,
  });
}

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw|rv):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function isInternal(email: string): boolean {
  return INTERNAL_DOMAINS.some(d => email.endsWith(`@${d}`));
}

/**
 * Fetch emails for a single Gmail account using History API (incremental)
 * or messages.list (bootstrap).
 */
async function fetchAccountEmails(
  serviceAccountJson: string,
  account: GmailAccount,
  historyId?: string
): Promise<{ emails: ParsedEmail[]; newHistoryId: string | null }> {
  const auth = getAuthClient(serviceAccountJson, account.email);
  const gmail = google.gmail({ version: "v1", auth });

  let messageIds: string[] = [];
  let newHistoryId: string | null = null;

  if (historyId) {
    // Incremental sync via History API
    try {
      const historyRes = await gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
      });
      newHistoryId = historyRes.data.historyId ?? null;
      const history = historyRes.data.history ?? [];
      for (const h of history) {
        for (const msg of h.messagesAdded ?? []) {
          if (msg.message?.id) messageIds.push(msg.message.id);
        }
      }
    } catch (err: unknown) {
      const status = (err as { code?: number })?.code;
      if (status === 404) {
        // History expired, fall back to bootstrap
        console.warn(`[gmail] History expired for ${account.email}, bootstrapping`);
        return fetchAccountEmails(serviceAccountJson, account);
      }
      throw err;
    }
  } else {
    // Bootstrap: fetch last 72h (wider window for initial runs / weekends)
    const after = Math.floor(Date.now() / 1000) - 72 * 3600;
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `after:${after}`,
      maxResults: 100,
    });
    messageIds = (listRes.data.messages ?? []).map(m => m.id!).filter(Boolean);

    // Get current historyId for future incremental syncs
    const profile = await gmail.users.getProfile({ userId: "me" });
    newHistoryId = profile.data.historyId ?? null;
  }

  if (!messageIds.length) {
    return { emails: [], newHistoryId };
  }

  // Deduplicate
  messageIds = [...new Set(messageIds)];

  // Fetch message details (batch of 10 concurrent)
  const emails: ParsedEmail[] = [];
  const chunks = chunkArray(messageIds, 10);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (msgId) => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "full",
        });
        return parseMessage(msg.data as Record<string, unknown>, account);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) emails.push(r.value);
    }
  }

  return { emails, newHistoryId };
}

/**
 * Convierte un mensaje de Gmail (format=full) en ParsedEmail.
 *
 * Ingest v2 (Memoria Fase 1): conserva el cuerpo completo, el HTML, los
 * encabezados de threading (Message-ID / In-Reply-To / References), Cc/Bcc y
 * labels, y deriva `body_clean` sin citas ni firma. `body` sigue siendo el
 * texto colapsado a 5,000 chars para los consumidores legacy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMessage(msg: any, account: GmailAccount): ParsedEmail | null {
  if (!msg?.id || !msg.payload) return null;

  const headers: { name?: string; value?: string }[] = msg.payload.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h: { name?: string }) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const from = getHeader("From");
  const fromEmail = extractEmail(from);
  const to = getHeader("To");
  const cc = getHeader("Cc");
  const bcc = getHeader("Bcc");
  const subject = getHeader("Subject") || "(sin asunto)";
  const date = getHeader("Date");
  const messageIdHdr = getHeader("Message-ID") || getHeader("Message-Id") || null;
  const inReplyTo = getHeader("In-Reply-To") || null;
  const references = getHeader("References").split(/\s+/).map((r) => r.trim()).filter(Boolean);

  // Cuerpos: primer text/plain y primer text/html (sin adjuntos con filename)
  const bodies = collectBodies(msg.payload);
  const plainRaw = bodies.plain ? decodeBody(bodies.plain) : "";
  const html = bodies.html ? decodeBody(bodies.html) : "";
  const bodyFull = (plainRaw.trim() ? plainRaw : htmlToText(html)).replace(/\r\n?/g, "\n").trim();
  const bodyClean = stripQuotedText(bodyFull);

  // Attachments
  const attachments = extractAttachments(msg.payload.parts ?? []);
  const rawJson = JSON.stringify(msg);

  return {
    account: account.email,
    department: account.department,
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId ?? msg.id,
    from,
    from_email: fromEmail,
    to,
    cc,
    bcc,
    subject,
    subject_normalized: normalizeSubject(subject),
    date,
    body: legacyBody(bodyFull, 5000),
    body_full: bodyFull,
    body_html: html ? html.slice(0, MAX_HTML_CHARS) : null,
    body_clean: bodyClean,
    snippet: (msg.snippet ?? "").slice(0, 500),
    attachments,
    has_attachments: attachments.length > 0,
    is_reply: /^(re|rv):/i.test(subject) || Boolean(inReplyTo),
    sender_type: isInternal(fromEmail) ? "internal" : "external",
    message_id_hdr: messageIdHdr,
    in_reply_to_hdr: inReplyTo,
    references_hdr: references,
    labels: Array.isArray(msg.labelIds) ? msg.labelIds.map(String) : [],
    raw_payload: msg,
    raw_size_bytes: Buffer.byteLength(rawJson, "utf-8"),
    ingest_version: INGEST_VERSION,
  };
}

function decodeBody(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

interface MimePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
}

/**
 * Recorre el árbol MIME y devuelve el primer text/plain y el primer text/html
 * que NO sean adjuntos. Maneja multipart/alternative, multipart/mixed y
 * multipart/related anidados (Outlook mete el HTML dentro de related).
 */
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

export function extractAttachments(parts: unknown[]): ParsedAttachment[] {
  const attachments: ParsedAttachment[] = [];
  for (const part of parts as { filename?: string; mimeType?: string; body?: { size?: number; attachmentId?: string; data?: string }; parts?: unknown[] }[]) {
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      attachments.push(...extractAttachments(part.parts));
    }
  }
  return attachments;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deduplicate emails by fingerprint (from_email | subject_normalized | date_minute).
 */
function deduplicateEmails(emails: ParsedEmail[]): ParsedEmail[] {
  const seen = new Set<string>();
  return emails.filter(e => {
    const dateMinute = (e.date ?? "").replace(/:\d{2}\s/, " ").slice(0, 16);
    const fp = `${e.from_email}|${e.subject_normalized}|${dateMinute}`;
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

/**
 * Backfill: fetch emails for one account with a custom Gmail query and
 * pagination cursor. Used by /api/pipeline/backfill-emails to import
 * historical mail in chunks that fit within Vercel's request budget.
 *
 * Returns the parsed emails plus the nextPageToken so the caller can
 * resume in a follow-up request. When nextPageToken is null, the backfill
 * is complete for this query.
 */
export async function fetchAccountEmailsByQuery(
  serviceAccountJson: string,
  account: GmailAccount,
  query: string,
  pageToken?: string,
  pageSize = 100,
): Promise<{ emails: ParsedEmail[]; nextPageToken: string | null }> {
  const auth = getAuthClient(serviceAccountJson, account.email);
  const gmail = google.gmail({ version: "v1", auth });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: Math.min(pageSize, 500),
    pageToken,
  });

  const messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  const nextPageToken = listRes.data.nextPageToken ?? null;

  if (!messageIds.length) {
    return { emails: [], nextPageToken };
  }

  const emails: ParsedEmail[] = [];
  for (const c of chunkArray([...new Set(messageIds)], 10)) {
    const results = await Promise.allSettled(
      c.map(async (msgId) => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "full",
        });
        return parseMessage(msg.data as Record<string, unknown>, account);
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) emails.push(r.value);
    }
  }

  return { emails, nextPageToken };
}

/**
 * Main entry point: sync all Gmail accounts in parallel.
 */
export async function syncAllAccounts(
  serviceAccountJson: string,
  accounts: GmailAccount[],
  historyState: Record<string, string> = {},
  maxConcurrent = 5
): Promise<{
  emails: ParsedEmail[];
  newHistoryState: Record<string, string>;
  successCount: number;
  failedCount: number;
}> {
  const newHistoryState: Record<string, string> = { ...historyState };
  let allEmails: ParsedEmail[] = [];
  let successCount = 0;
  let failedCount = 0;

  // Process in chunks to limit concurrency
  const chunks = chunkArray(accounts, maxConcurrent);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (account) => {
        const historyId = historyState[account.email];
        const result = await fetchAccountEmails(serviceAccountJson, account, historyId);
        if (result.newHistoryId) {
          newHistoryState[account.email] = result.newHistoryId;
        }
        return result.emails;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        allEmails.push(...r.value);
        successCount++;
      } else {
        failedCount++;
        console.error("[gmail] Account sync failed:", r.reason);
      }
    }
  }

  allEmails = deduplicateEmails(allEmails);

  return { emails: allEmails, newHistoryState, successCount, failedCount };
}

export type { ParsedEmail, ParsedAttachment, GmailAccount };
