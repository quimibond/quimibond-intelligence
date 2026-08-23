/**
 * Envío de alertas por correo usando el service account de Gmail
 * (domain-wide delegation) que ya usa el pipeline de sync.
 *
 * REQUISITO: el scope https://www.googleapis.com/auth/gmail.send debe estar
 * autorizado para el client del service account en Google Workspace Admin
 * (Seguridad → Controles de API → Delegación de dominio). Si no lo está,
 * el envío falla con unauthorized_client y el watchdog degrada a solo
 * loggear en pipeline_logs (visible en /hoy → salud de datos).
 */

import "server-only";
import { google } from "googleapis";
import { JWT } from "google-auth-library";

const SEND_SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export interface AlertEmailResult {
  ok: boolean;
  error?: string;
}

/** Base64 con saltos de línea cada 76 chars (RFC 2045). */
function b64Wrap(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

export async function sendAlertEmail(
  subject: string,
  textBody: string,
  htmlBody?: string,
): Promise<AlertEmailResult> {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado" };
  }

  const from = process.env.WATCHDOG_FROM ?? "info@quimibond.com";
  const to = process.env.WATCHDOG_TO ?? "jose.mizrahi@quimibond.com";

  try {
    const creds = JSON.parse(serviceAccountJson);
    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SEND_SCOPES,
      subject: from,
    });
    const gmail = google.gmail({ version: "v1", auth });

    const headers = [
      `From: Quimibond Intelligence <${from}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
    ];

    // Con htmlBody manda multipart/alternative (texto plano como fallback);
    // sin él, texto plano igual que siempre.
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
      mime = [...headers, "Content-Type: text/plain; charset=UTF-8", "", textBody];
    }

    const raw = Buffer.from(mime.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
