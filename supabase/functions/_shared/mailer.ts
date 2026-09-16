/**
 * Envío de correo con el service account de Gmail (delegación de dominio,
 * scope gmail.send) desde Edge Functions. Versión Deno de
 * src/lib/alerts/send-email.ts: mismo remitente (WATCHDOG_FROM,
 * default info@quimibond.com) y destinatario (WATCHDOG_TO, default el CEO).
 * Si el scope gmail.send no está autorizado en Workspace, devuelve ok=false
 * con el error y el llamador degrada a solo log.
 */
import { GmailClient, SCOPE_SEND, loadServiceAccount } from "./gmail.ts";

export interface MailResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 con saltos cada 76 caracteres (RFC 2045). */
function b64Wrap(s: string): string {
  return b64(s).replace(/(.{76})/g, "$1\r\n");
}

export function mailDefaults(): { from: string; to: string } {
  return {
    from: Deno.env.get("WATCHDOG_FROM") ?? "info@quimibond.com",
    to: Deno.env.get("WATCHDOG_TO") ?? "jose.mizrahi@quimibond.com",
  };
}

export async function sendMail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  subject: string,
  textBody: string,
  htmlBody?: string,
  opts: { from?: string; to?: string; fromName?: string } = {},
): Promise<MailResult> {
  const sa = await loadServiceAccount(supabase);
  if (!sa) return { ok: false, error: "google_service_account_json no configurado" };
  const d = mailDefaults();
  const from = opts.from ?? d.from;
  const to = opts.to ?? d.to;
  const fromName = opts.fromName ?? "Quimibond Intelligence";

  const headers = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
  ];
  let mime: string[];
  if (htmlBody) {
    const boundary = `=_qb_${Date.now().toString(36)}`;
    mime = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64Wrap(textBody),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64Wrap(htmlBody),
      `--${boundary}--`,
    ];
  } else {
    mime = [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Wrap(textBody)];
  }

  try {
    const gmail = new GmailClient(sa, from, SCOPE_SEND);
    const res = await gmail.send(mime.join("\r\n"));
    return { ok: true, id: res.id };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) };
  }
}
