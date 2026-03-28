/**
 * Gmail Service — Fetches emails via Gmail API with Service Account.
 * Port of qb19's gmail_service.py to TypeScript.
 */
import { google } from "googleapis";
import { JWT } from "google-auth-library";

interface GmailAccount {
  email: string;
  department: string;
}

interface ParsedEmail {
  account: string;
  department: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  from: string;
  from_email: string;
  to: string;
  subject: string;
  subject_normalized: string;
  date: string;
  body: string;
  snippet: string;
  attachments: { filename: string; mimeType: string; size: number }[];
  has_attachments: boolean;
  is_reply: boolean;
  sender_type: "internal" | "external";
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
    // Bootstrap: fetch last 24h
    const after = Math.floor(Date.now() / 1000) - 86400;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMessage(msg: any, account: GmailAccount): ParsedEmail | null {
  if (!msg.id || !msg.payload) return null;

  const headers: { name?: string; value?: string }[] = msg.payload.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h: { name?: string }) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const from = getHeader("From");
  const fromEmail = extractEmail(from);
  const to = getHeader("To");
  const subject = getHeader("Subject") || "(sin asunto)";
  const date = getHeader("Date");

  // Extract body
  let body = "";
  if (msg.payload.body?.data) {
    body = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
  } else if (msg.payload.parts) {
    body = extractBodyFromParts(msg.payload.parts);
  }
  // Strip HTML tags for plain text
  body = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Attachments
  const attachments = extractAttachments(msg.payload.parts ?? []);

  return {
    account: account.email,
    department: account.department,
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId ?? msg.id,
    from,
    from_email: fromEmail,
    to,
    subject,
    subject_normalized: normalizeSubject(subject),
    date,
    body: body.slice(0, 5000),
    snippet: (msg.snippet ?? "").slice(0, 500),
    attachments,
    has_attachments: attachments.length > 0,
    is_reply: /^(re|rv):/i.test(subject),
    sender_type: isInternal(fromEmail) ? "internal" : "external",
  };
}

function extractBodyFromParts(parts: unknown[]): string {
  for (const part of parts as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[]) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts);
      if (nested) return nested;
    }
  }
  // Fallback to HTML
  for (const part of parts as { mimeType?: string; body?: { data?: string } }[]) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
  }
  return "";
}

function extractAttachments(parts: unknown[]): { filename: string; mimeType: string; size: number }[] {
  const attachments: { filename: string; mimeType: string; size: number }[] = [];
  for (const part of parts as { filename?: string; mimeType?: string; body?: { size?: number; attachmentId?: string }; parts?: unknown[] }[]) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
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

export type { ParsedEmail, GmailAccount };
