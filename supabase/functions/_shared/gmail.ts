/**
 * Cliente mínimo de Gmail para Edge Functions (Deno).
 *
 * Sin `googleapis` (100 MB, fuera del límite de bundle): firma el JWT del
 * service account con `jose`, cambia el token con OAuth2 y llama la API REST
 * con fetch. Delegación de dominio: `subject` = buzón a impersonar.
 */
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const SCOPE_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getAccessToken(sa: ServiceAccount, subject: string, scope: string): Promise<string> {
  const key = `${subject}|${scope}`;
  const cached = tokenCache.get(key);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const pk = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope, sub: subject })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri ?? "https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`gmail token ${subject}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(key, { token: json.access_token, exp: now + (json.expires_in ?? 3600) });
  return json.access_token;
}

export class GmailApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class GmailClient {
  private base = "https://gmail.googleapis.com/gmail/v1/users/me";
  constructor(private sa: ServiceAccount, private subject: string, private scope = SCOPE_READONLY) {}

  private async call<T>(path: string, init: RequestInit = {}, params?: Record<string, string | undefined>): Promise<T> {
    const token = await getAccessToken(this.sa, this.subject, this.scope);
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      throw new GmailApiError(res.status, `gmail ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  getProfile() {
    return this.call<{ historyId?: string; emailAddress?: string }>("/profile");
  }

  historyList(startHistoryId: string, pageToken?: string) {
    return this.call<{
      historyId?: string;
      nextPageToken?: string;
      history?: { messagesAdded?: { message?: { id?: string } }[] }[];
    }>("/history", {}, { startHistoryId, historyTypes: "messageAdded", pageToken });
  }

  messagesList(q: string, maxResults: number, pageToken?: string) {
    return this.call<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", {}, {
      q,
      maxResults: String(maxResults),
      pageToken,
    });
  }

  // deno-lint-ignore no-explicit-any
  messageGet(id: string): Promise<any> {
    return this.call("/messages/" + encodeURIComponent(id), {}, { format: "full" });
  }

  attachmentGet(messageId: string, attachmentId: string) {
    return this.call<{ data?: string; size?: number }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  /** Envía un mensaje MIME crudo (requiere scope gmail.send). */
  send(rawMime: string) {
    const raw = base64url(new TextEncoder().encode(rawMime));
    return this.call<{ id?: string }>("/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
  }
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (data.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeBase64UrlText(data: string): string {
  try {
    return new TextDecoder("utf-8").decode(decodeBase64Url(data));
  } catch {
    return "";
  }
}

/** Lee el service account: primero variable de entorno, luego Vault vía RPC. */
export async function loadServiceAccount(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<ServiceAccount | null> {
  const env = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (env) return JSON.parse(env) as ServiceAccount;
  const { data, error } = await supabase.rpc("edge_secret", { p_name: "google_service_account_json" });
  if (error || !data) return null;
  return JSON.parse(String(data)) as ServiceAccount;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
