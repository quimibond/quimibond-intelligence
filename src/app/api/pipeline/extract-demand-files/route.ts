/**
 * Fase 2 del cruce de demanda (2026-08-11): releases/forecasts que llegan
 * como EXCEL/CSV adjunto.
 *
 * Descarga los adjuntos desde Gmail (mismo service account con
 * gmail.readonly; el attachmentId ya viene en emails.attachments),
 * convierte las hojas a CSV con SheetJS y extrae las líneas de demanda
 * con el mismo prompt acotado de la fase 1 → customer_demand_signals
 * (dedup compartido por (source_email_id, product_ref, period_label)).
 */

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import * as XLSX from "xlsx";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { callClaudeJSON } from "@/lib/claude";

export const maxDuration = 300;

const EMAILS_PER_RUN = 6;
const MAX_SHEET_CHARS = 8000;
const SPREADSHEET_MIME =
  /(spreadsheetml|ms-excel|text\/csv|application\/csv)/i;

interface AttachmentMeta {
  filename?: string;
  mimeType?: string;
  size?: number;
  attachmentId?: string;
}

interface DemandLine {
  product_ref: string | null;
  product_desc: string | null;
  qty: number;
  uom: string | null;
  period_label: string | null;
  demand_date: string | null;
}

// Mismo contrato que extract-demand (fase 1) — mantener en sync.
const EXTRACTION_SYSTEM = `Eres un extractor de demanda en archivos que clientes de Quimibond (textil, México) adjuntan a sus correos: releases semanales, forecasts y programas de recolección convertidos a CSV.

Devuelve SOLO un array JSON (sin markdown) con las líneas de demanda EXPLÍCITAS:

[{"product_ref": "clave del producto tal como aparece (ej. WJ053Q22JNT160) o null", "product_desc": "descripción corta o null", "qty": número, "uom": "m|yd|kg|rollos|pzas|lm o null", "period_label": "CW32, semana 33, agosto, etc. o null", "demand_date": "YYYY-MM-DD o null"}]

Reglas estrictas:
- Solo cantidades que el CLIENTE pide/proyecta/agenda. NO montos de dinero, números de factura, inventarios del cliente ni pesos de rollos.
- Si hay columnas por semana/mes (forecast), genera una línea por periodo con su period_label.
- Si el archivo no es de demanda (factura, estado de cuenta, ficha técnica), devuelve [].
- Máximo 25 líneas (prioriza las de mayor cantidad).`;

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

function sheetToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 3)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (csv.trim()) parts.push(`--- Hoja: ${name} ---\n${csv.slice(0, MAX_SHEET_CHARS)}`);
  }
  return parts.join("\n\n").slice(0, MAX_SHEET_CHARS * 2);
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!apiKey || !serviceAccountJson) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY / GOOGLE_SERVICE_ACCOUNT_JSON no configurado" },
      { status: 503 },
    );
  }

  const supabase = getServiceClient();
  const started = Date.now();

  try {
    const { data: candidates } = await supabase.rpc("analyst_query", {
      p_sql: `SELECT e.id AS email_id, e.thread_id, e.company_id, c.name AS company_name,
          e.subject, e.gmail_message_id, e.account, e.attachments
        FROM emails e
        JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
        WHERE e.sender_type = 'external'
          AND e.email_date > now() - interval '7 days'
          AND e.has_attachments
          AND e.attachments::text ~* '(xlsx|xls|csv)'
          AND (e.subject ~* '(release|forecast|programa|recolec|pedido|demanda|requerimiento|schedule|CW[0-9])'
            OR e.attachments::text ~* '(release|forecast|programa|pedido|demanda|schedule)')
          AND NOT EXISTS (SELECT 1 FROM demand_scan_log s WHERE s.email_id = e.id AND s.attachments_scanned)
        ORDER BY e.email_date DESC
        LIMIT ${EMAILS_PER_RUN}`,
    });

    const emails = Array.isArray(candidates) ? candidates : [];
    let signals = 0;
    let scanned = 0;
    let files = 0;

    for (const em of emails as Array<{
      email_id: number;
      thread_id: number | null;
      company_id: number | null;
      company_name: string | null;
      subject: string | null;
      gmail_message_id: string;
      account: string;
      attachments: AttachmentMeta[] | null;
    }>) {
      if (Date.now() - started > 240_000) break;

      try {
        const sheets = (em.attachments ?? []).filter(
          (a) =>
            a.attachmentId &&
            (SPREADSHEET_MIME.test(a.mimeType ?? "") || /\.(xlsx|xls|csv)$/i.test(a.filename ?? "")) &&
            (a.size ?? 0) < 4_000_000,
        );

        const texts: string[] = [];
        if (sheets.length) {
          const gmail = gmailFor(serviceAccountJson, em.account);
          for (const att of sheets.slice(0, 2)) {
            try {
              const res = await gmail.users.messages.attachments.get({
                userId: "me",
                messageId: em.gmail_message_id,
                id: att.attachmentId!,
              });
              const data = res.data.data;
              if (!data) continue;
              const buffer = Buffer.from(data, "base64url");
              const text = sheetToText(buffer);
              if (text.trim()) {
                texts.push(`Archivo: ${att.filename ?? "adjunto"}\n${text}`);
                files++;
              }
            } catch (err) {
              console.error(`[extract-demand-files] attachment ${att.filename}`, err);
            }
          }
        }

        let lines: DemandLine[] = [];
        if (texts.length) {
          const { result } = await callClaudeJSON<DemandLine[]>(
            apiKey,
            {
              max_tokens: 2000,
              temperature: 0,
              system: EXTRACTION_SYSTEM,
              messages: [
                {
                  role: "user",
                  content: `Cliente: ${em.company_name ?? "?"}\nAsunto del correo: ${em.subject ?? ""}\n\n${texts.join("\n\n")}`,
                },
              ],
            },
            "extract-demand-files",
          );
          lines = (Array.isArray(result) ? result : []).filter((l) => Number(l.qty) > 0).slice(0, 25);
        }

        if (lines.length) {
          const rows = lines.map((l) => ({
            source_email_id: em.email_id,
            thread_id: em.thread_id,
            company_id: em.company_id,
            company_name: em.company_name,
            product_ref: l.product_ref ? String(l.product_ref).trim().toUpperCase() : null,
            product_desc: l.product_desc ? String(l.product_desc).slice(0, 200) : null,
            qty: Number(l.qty),
            uom: l.uom ? String(l.uom).toLowerCase() : null,
            period_label: l.period_label ? String(l.period_label).slice(0, 40) : null,
            demand_date:
              l.demand_date && /^\d{4}-\d{2}-\d{2}$/.test(l.demand_date) ? l.demand_date : null,
          }));
          const { error } = await supabase
            .from("customer_demand_signals")
            .upsert(rows, { onConflict: "source_email_id,product_ref,period_label", ignoreDuplicates: true });
          if (!error) signals += rows.length;
        }

        await supabase.from("demand_scan_log").upsert(
          {
            email_id: em.email_id,
            attachments_scanned: true,
            attachment_signals: lines.length,
          },
          { onConflict: "email_id" },
        );
        scanned++;
      } catch (err) {
        console.error(`[extract-demand-files] email ${em.email_id}`, err);
      }
    }

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "extract_demand",
      message: `Demanda (adjuntos): ${signals} líneas de ${files} archivos en ${scanned} correos`,
      details: { signals, files, scanned, source: "attachments" },
    });

    return NextResponse.json({ ok: true, signals, files, scanned });
  } catch (err) {
    console.error("[extract-demand-files] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
