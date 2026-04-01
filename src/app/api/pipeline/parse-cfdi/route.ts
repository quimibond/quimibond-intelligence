/**
 * CFDI XML Parser — Extracts structured invoice data without AI.
 *
 * Finds emails with XML attachments, downloads them via Gmail API,
 * parses the CFDI structure, and stores in cfdi_documents table.
 *
 * Zero AI cost. Pure structured data extraction.
 *
 * CFDI fields extracted:
 * - Emisor/Receptor: RFC, nombre
 * - Amounts: subtotal, total, impuestos, descuentos
 * - Conceptos: descripcion, cantidad, valor unitario
 * - Metadata: UUID, serie, folio, metodo/forma de pago
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return NextResponse.json({ error: "GOOGLE_SERVICE_ACCOUNT_JSON not set" }, { status: 503 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase = createClient(url, key);

  try {
    // Find emails with XML attachments that haven't been parsed yet
    const { data: emails } = await supabase
      .from("emails")
      .select("id, gmail_message_id, account, attachments")
      .eq("has_attachments", true)
      .not("attachments", "is", null)
      .order("email_date", { ascending: false })
      .limit(200);

    if (!emails?.length) {
      return NextResponse.json({ success: true, message: "No emails with attachments", parsed: 0 });
    }

    // Filter emails that have XML attachments
    const xmlEmails: { id: number; gmail_message_id: string; account: string; xmlAttachments: { filename: string; attachmentId?: string }[] }[] = [];

    for (const email of emails) {
      const attachments = email.attachments as { filename: string; mimeType: string; attachmentId?: string }[];
      if (!attachments?.length) continue;

      const xmlAtts = attachments.filter(a =>
        a.mimeType === "text/xml" || a.mimeType === "application/xml" ||
        a.filename?.toLowerCase().endsWith(".xml")
      );

      if (xmlAtts.length > 0) {
        // Check if already parsed
        const { data: existing } = await supabase
          .from("cfdi_documents")
          .select("id")
          .eq("email_id", email.id)
          .limit(1);

        if (!existing?.length) {
          xmlEmails.push({
            id: email.id,
            gmail_message_id: email.gmail_message_id,
            account: email.account,
            xmlAttachments: xmlAtts,
          });
        }
      }
    }

    if (!xmlEmails.length) {
      return NextResponse.json({ success: true, message: "No new XML attachments to parse", parsed: 0 });
    }

    let parsed = 0;
    let errors = 0;

    // Process in batches of 10
    for (const email of xmlEmails.slice(0, 50)) {
      for (const att of email.xmlAttachments) {
        try {
          // Download XML content via Gmail API
          const xmlContent = await downloadAttachment(
            serviceAccountJson,
            email.account,
            email.gmail_message_id,
            att.attachmentId
          );

          if (!xmlContent) continue;

          // Parse CFDI
          const cfdi = parseCFDI(xmlContent);
          if (!cfdi) continue;

          // Save to database
          const { error: insertErr } = await supabase.from("cfdi_documents").insert({
            email_id: email.id,
            gmail_message_id: email.gmail_message_id,
            account: email.account,
            emisor_rfc: cfdi.emisorRfc,
            emisor_nombre: cfdi.emisorNombre,
            receptor_rfc: cfdi.receptorRfc,
            receptor_nombre: cfdi.receptorNombre,
            tipo_comprobante: cfdi.tipoComprobante,
            serie: cfdi.serie,
            folio: cfdi.folio,
            uuid: cfdi.uuid,
            fecha: cfdi.fecha,
            subtotal: cfdi.subtotal,
            total: cfdi.total,
            moneda: cfdi.moneda,
            tipo_cambio: cfdi.tipoCambio,
            descuento: cfdi.descuento,
            total_impuestos_trasladados: cfdi.impuestosTrasladados,
            total_impuestos_retenidos: cfdi.impuestosRetenidos,
            conceptos: cfdi.conceptos,
            metodo_pago: cfdi.metodoPago,
            forma_pago: cfdi.formaPago,
            uso_cfdi: cfdi.usoCfdi,
            raw_xml: xmlContent.slice(0, 50000), // cap at 50K to avoid bloat
          });

          if (insertErr) {
            if (insertErr.code === "23505") {
              // Duplicate UUID — already parsed, skip
            } else {
              console.error(`[cfdi] Insert error for email ${email.id}:`, insertErr.message);
              errors++;
            }
          } else {
            parsed++;
          }
        } catch (err) {
          console.error(`[cfdi] Error processing attachment ${att.filename} from email ${email.id}:`, err);
          errors++;
        }
      }
    }

    // Log results
    if (parsed > 0 || errors > 0) {
      await supabase.from("pipeline_logs").insert({
        level: errors > 0 ? "warning" : "info",
        phase: "cfdi_parse",
        message: `CFDI: ${parsed} parsed, ${errors} errors from ${xmlEmails.length} emails`,
        details: { parsed, errors, emails_checked: xmlEmails.length },
      });
    }

    return NextResponse.json({ success: true, parsed, errors, emails_with_xml: xmlEmails.length });
  } catch (err) {
    console.error("[cfdi] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Download attachment content via Gmail API ───────────────────────────

async function downloadAttachment(
  serviceAccountJson: string,
  account: string,
  messageId: string,
  attachmentId?: string
): Promise<string | null> {
  if (!attachmentId) return null;

  try {
    const creds = JSON.parse(serviceAccountJson);
    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: account,
    });

    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!res.data.data) return null;

    // Gmail returns base64url encoded data
    return Buffer.from(res.data.data, "base64url").toString("utf-8");
  } catch (err) {
    console.error(`[cfdi] Download failed for ${account}/${messageId}:`, err);
    return null;
  }
}

// ── Parse CFDI XML without any AI ───────────────────────────────────────

interface CFDIData {
  emisorRfc: string;
  emisorNombre: string;
  receptorRfc: string;
  receptorNombre: string;
  tipoComprobante: string;
  serie: string | null;
  folio: string | null;
  uuid: string | null;
  fecha: string | null;
  subtotal: number;
  total: number;
  moneda: string;
  tipoCambio: number;
  descuento: number;
  impuestosTrasladados: number;
  impuestosRetenidos: number;
  conceptos: { descripcion: string; cantidad: number; valorUnitario: number; importe: number; claveProdServ?: string; unidad?: string }[];
  metodoPago: string | null;
  formaPago: string | null;
  usoCfdi: string | null;
}

function parseCFDI(xml: string): CFDIData | null {
  try {
    // Extract Comprobante attributes
    const comprobante = xml.match(/<(?:cfdi:)?Comprobante\s([\s\S]+?)>/);

    if (!comprobante) return null;

    const attrs = comprobante[1];

    // Extract Emisor
    const emisor = xml.match(/<(?:cfdi:)?Emisor\s([^/>]+)\/?>/);
    const emisorRfc = extractAttr(emisor?.[1], "Rfc");
    const emisorNombre = extractAttr(emisor?.[1], "Nombre");

    // Extract Receptor
    const receptor = xml.match(/<(?:cfdi:)?Receptor\s([^/>]+)\/?>/);
    const receptorRfc = extractAttr(receptor?.[1], "Rfc");
    const receptorNombre = extractAttr(receptor?.[1], "Nombre");

    if (!emisorRfc && !receptorRfc) return null; // Not a valid CFDI

    // Extract UUID from TimbreFiscalDigital
    const timbre = xml.match(/<(?:tfd:)?TimbreFiscalDigital\s([^/>]+)\/?>/);
    const uuid = extractAttr(timbre?.[1], "UUID");

    // Extract Conceptos
    const conceptos: CFDIData["conceptos"] = [];
    const conceptoRegex = /<(?:cfdi:)?Concepto\s([^/>]+)\/?>/g;
    let conceptoMatch;
    while ((conceptoMatch = conceptoRegex.exec(xml)) !== null) {
      const cAttrs = conceptoMatch[1];
      conceptos.push({
        descripcion: extractAttr(cAttrs, "Descripcion") || "",
        cantidad: parseFloat(extractAttr(cAttrs, "Cantidad") || "0"),
        valorUnitario: parseFloat(extractAttr(cAttrs, "ValorUnitario") || "0"),
        importe: parseFloat(extractAttr(cAttrs, "Importe") || "0"),
        claveProdServ: extractAttr(cAttrs, "ClaveProdServ") || undefined,
        unidad: extractAttr(cAttrs, "ClaveUnidad") || extractAttr(cAttrs, "Unidad") || undefined,
      });
    }

    // Extract Impuestos
    const impTraslados = xml.match(/TotalImpuestosTrasladados="([^"]+)"/);
    const impRetenidos = xml.match(/TotalImpuestosRetenidos="([^"]+)"/);

    return {
      emisorRfc: emisorRfc || "",
      emisorNombre: emisorNombre || "",
      receptorRfc: receptorRfc || "",
      receptorNombre: receptorNombre || "",
      tipoComprobante: extractAttr(attrs, "TipoDeComprobante") || extractAttr(attrs, "tipoDeComprobante") || "I",
      serie: extractAttr(attrs, "Serie"),
      folio: extractAttr(attrs, "Folio"),
      uuid,
      fecha: extractAttr(attrs, "Fecha"),
      subtotal: parseFloat(extractAttr(attrs, "SubTotal") || "0"),
      total: parseFloat(extractAttr(attrs, "Total") || "0"),
      moneda: extractAttr(attrs, "Moneda") || "MXN",
      tipoCambio: parseFloat(extractAttr(attrs, "TipoCambio") || "1"),
      descuento: parseFloat(extractAttr(attrs, "Descuento") || "0"),
      impuestosTrasladados: parseFloat(impTraslados?.[1] || "0"),
      impuestosRetenidos: parseFloat(impRetenidos?.[1] || "0"),
      conceptos,
      metodoPago: extractAttr(attrs, "MetodoPago"),
      formaPago: extractAttr(attrs, "FormaDePago") || extractAttr(attrs, "FormaPago"),
      usoCfdi: extractAttr(receptor?.[1], "UsoCFDI"),
    };
  } catch (err) {
    console.error("[cfdi] Parse error:", err);
    return null;
  }
}

function extractAttr(str: string | undefined, name: string): string | null {
  if (!str) return null;
  // Match both Name="value" and name="value" (case insensitive for the first char)
  const regex = new RegExp(`${name}="([^"]*)"`, "i");
  const match = str.match(regex);
  return match ? match[1] : null;
}
