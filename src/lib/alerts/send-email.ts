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

export async function sendAlertEmail(
  subject: string,
  textBody: string,
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

    const raw = Buffer.from(
      [
        `From: Quimibond Intelligence <${from}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        textBody,
      ].join("\r\n"),
    )
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
