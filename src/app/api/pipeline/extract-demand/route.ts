/**
 * Extractor de demanda de clientes desde el correo (2026-08-11).
 *
 * Lee correos de clientes que traen releases/forecasts/programas de
 * recolección escritos en el cuerpo y extrae las líneas de demanda
 * (producto, cantidad, unidad, periodo) hacia customer_demand_signals.
 * El cruce contra pedidos/entregas de Odoo lo hace get_demand_vs_orders
 * y se muestra en /operacion.
 *
 * Fase 1: solo cuerpos de correo. Los Excel adjuntos (fase 2) requieren
 * descarga desde Gmail.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { callClaudeJSON } from "@/lib/claude";

export const maxDuration = 300;

const EMAILS_PER_RUN = 12;

interface DemandLine {
  product_ref: string | null;
  product_desc: string | null;
  qty: number;
  uom: string | null;
  period_label: string | null;
  demand_date: string | null;
}

const EXTRACTION_SYSTEM = `Eres un extractor de demanda en correos comerciales de Quimibond (textil, México). Los clientes mandan releases semanales, forecasts y programas de recolección con cantidades de producto.

Devuelve SOLO un array JSON (sin markdown) con las líneas de demanda EXPLÍCITAS en el correo:

[{"product_ref": "clave del producto tal como aparece (ej. WJ053Q22JNT160) o null si solo hay descripción", "product_desc": "descripción corta o null", "qty": número, "uom": "m|yd|kg|rollos|pzas|lm o null", "period_label": "CW32, semana 33, agosto, etc. o null", "demand_date": "YYYY-MM-DD si hay fecha concreta o null"}]

Reglas estrictas:
- Solo cantidades que el CLIENTE pide/proyecta/agenda. NO extraigas montos de dinero, números de factura ni pesos de rollos.
- Si una tabla trae varias columnas de cantidad (yd, m, m2), usa la de METROS (m) si existe; si no, la principal.
- Si el correo no trae demanda (es cobranza, calidad, trámite), devuelve [].
- Máximo 15 líneas.`;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado" }, { status: 503 });
  }

  const supabase = getServiceClient();
  const started = Date.now();

  try {
    const { data: candidates } = await supabase.rpc("analyst_query", {
      p_sql: `SELECT e.id AS email_id, e.thread_id, e.company_id, c.name AS company_name,
          e.subject, left(coalesce(e.body, e.snippet, ''), 6000) AS cuerpo
        FROM emails e
        JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
        WHERE e.sender_type = 'external'
          AND e.email_date > now() - interval '7 days'
          AND e.sender !~* '(no-?reply|postmaster|notificacion|newsletter|digest)'
          AND (e.subject ~* '(release|forecast|programa|recolec|pedido|demanda|requerimiento|schedule|CW[0-9])'
            OR e.body ~* '(release de|forecast|programa de (entrega|recolec)|favor de ajustar cantidades)')
          AND NOT EXISTS (SELECT 1 FROM demand_scan_log s WHERE s.email_id = e.id)
        ORDER BY e.email_date DESC
        LIMIT ${EMAILS_PER_RUN}`,
    });

    const emails = Array.isArray(candidates) ? candidates : [];
    let signals = 0;
    let scanned = 0;

    for (const em of emails as Array<{
      email_id: number;
      thread_id: number | null;
      company_id: number | null;
      company_name: string | null;
      subject: string | null;
      cuerpo: string;
    }>) {
      if (Date.now() - started > 240_000) break;

      try {
        const { result } = await callClaudeJSON<DemandLine[]>(
          apiKey,
          {
            max_tokens: 1200,
            temperature: 0,
            system: EXTRACTION_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Cliente: ${em.company_name ?? "?"}\nAsunto: ${em.subject ?? ""}\n\n${em.cuerpo}`,
              },
            ],
          },
          "extract-demand",
        );

        const lines = (Array.isArray(result) ? result : [])
          .filter((l) => Number(l.qty) > 0)
          .slice(0, 15);

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

        await supabase
          .from("demand_scan_log")
          .upsert({ email_id: em.email_id, signals_found: lines.length }, { onConflict: "email_id", ignoreDuplicates: true });
        scanned++;
      } catch (err) {
        console.error(`[extract-demand] email ${em.email_id}`, err);
      }
    }

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "extract_demand",
      message: `Demanda de clientes: ${signals} líneas extraídas de ${scanned} correos`,
      details: { signals, scanned },
    });

    return NextResponse.json({ ok: true, signals, scanned });
  } catch (err) {
    console.error("[extract-demand] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
