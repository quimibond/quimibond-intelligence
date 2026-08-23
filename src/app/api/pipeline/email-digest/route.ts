/**
 * Resumen ejecutivo del correo (2026-08-07).
 *
 * Genera con Claude un resumen del correo de las últimas 24h para el CEO:
 * lo importante, por cliente, pendientes con deadline y silencios. Se
 * guarda en email_digests, se muestra en /hoy y se envía por email
 * (misma infraestructura del watchdog).
 *
 * Disparo: cron diario 6:45am CDMX (12:45 UTC) o on-demand (POST desde el
 * botón en /hoy — cookie auth pasa por validatePipelineAuth). El on-demand
 * (?manual=1) NO manda email — el resultado se ve en la página.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { callClaude, logTokenUsage } from "@/lib/claude";
import { sendAlertEmail } from "@/lib/alerts/send-email";
import {
  renderDigestEmailHtml,
  type PendingActionRow,
  type UnansweredThreadRow,
  type SilentCustomerRow,
} from "@/lib/alerts/digest-email-html";

export const maxDuration = 120;

const SYSTEM = `Eres el asistente ejecutivo del CEO de Quimibond (textil, México). Escribe el resumen del correo de las últimas 24 horas, en español, en markdown, máximo ~400 palabras. Estructura:

## Lo más importante
3-6 bullets con lo que el CEO debe saber o decidir HOY (RFQs, urgencias, quejas, montos). Cita cliente y buzón.

## Por cliente
Solo clientes con actividad relevante (agrupa; ignora rutina como confirmaciones de entrega normales, notificaciones automáticas y facturas de trámite).

## Pendientes y silencios
Compromisos con deadline próximo y clientes importantes sin respuesta o callados.

Reglas: solo hechos que estén en los datos; no inventes nada; sé concreto (nombres, montos, fechas). Si el día estuvo tranquilo, dilo en una línea y no rellenes.`;

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

  const url = new URL(request.url);
  const isManual = url.searchParams.get("manual") === "1";

  const supabase = getServiceClient();

  try {
    // ── Insumos ──────────────────────────────────────────────────────────
    const [emailsRes, pendingRes, unansweredRes, silentRes] = await Promise.all([
      supabase.rpc("analyst_query", {
        p_sql: `SELECT c.name AS cliente, e.sender, e.subject, left(coalesce(e.snippet, e.body), 220) AS resumen,
            e.account AS buzon, to_char(e.email_date AT TIME ZONE 'America/Mexico_City', 'DD/MM HH24:MI') AS fecha
          FROM emails e
          JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
          WHERE e.sender_type = 'external'
            AND e.email_date > now() - interval '24 hours'
            AND e.sender !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|donotreply)'
          ORDER BY c.lifetime_value DESC, e.email_date DESC
          LIMIT 80`,
      }),
      supabase
        .from("email_pending_actions")
        .select("tipo, descripcion, deadline, company_name, account")
        .eq("status", "open")
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(15),
      supabase.rpc("get_unanswered_client_threads", { p_min_hours: 24, p_limit: 10 }),
      supabase.rpc("get_silent_customers", { p_silent_days: 21, p_min_emails_90d: 5, p_limit: 6 }),
    ]);

    const correos = Array.isArray(emailsRes.data) ? emailsRes.data : [];

    const input = JSON.stringify({
      correos_externos_24h: correos,
      pendientes_abiertos: pendingRes.data ?? [],
      hilos_sin_respuesta: unansweredRes.data ?? [],
      clientes_callados: silentRes.data ?? [],
    }).slice(0, 60_000);

    // ── Generación ───────────────────────────────────────────────────────
    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
    const res = await callClaude(
      apiKey,
      {
        model,
        max_tokens: 1500,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: `Datos de las últimas 24h:\n${input}` }],
        stream: false,
      },
      "email-digest",
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Claude ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      content: { type: string; text: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    if (json.usage) logTokenUsage("email-digest", model, json.usage.input_tokens, json.usage.output_tokens);
    const contentMd = json.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // ── Persistir ────────────────────────────────────────────────────────
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
    const pendientes = (pendingRes.data ?? []) as PendingActionRow[];
    const hilos = (Array.isArray(unansweredRes.data)
      ? unansweredRes.data
      : []) as UnansweredThreadRow[];
    const callados = (Array.isArray(silentRes.data)
      ? silentRes.data
      : []) as SilentCustomerRow[];
    const stats = {
      correos_externos_24h: correos.length,
      pendientes: pendientes.length,
      sin_respuesta: hilos.length,
      clientes_callados: callados.length,
    };

    // ── Email (solo cron) ────────────────────────────────────────────────
    const systemUrl = "https://quimibond-intelligence.vercel.app/hoy";
    let emailed = false;
    if (!isManual) {
      const dateLabel = new Date().toLocaleDateString("es-MX", {
        timeZone: "America/Mexico_City",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const html = renderDigestEmailHtml({
        dateLabel,
        contentMd,
        stats,
        pendientes,
        hilosSinRespuesta: hilos,
        clientesCallados: callados,
        systemUrl,
      });
      const result = await sendAlertEmail(
        `📬 Resumen de correo — ${today}`,
        `${contentMd}\n\n—\nVer en el sistema: ${systemUrl}`,
        html,
      );
      emailed = result.ok;
      if (!result.ok) console.error("[email-digest] send failed:", result.error);
    }

    await supabase.from("email_digests").insert({
      digest_date: today,
      content_md: contentMd,
      stats,
      trigger: isManual ? "manual" : "cron",
      emailed,
    });

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "email_digest",
      message: `Resumen de correo generado (${isManual ? "manual" : "cron"}): ${correos.length} correos, emailed=${emailed}`,
      details: stats,
    });

    return NextResponse.json({ ok: true, emailed, stats, content_md: contentMd });
  } catch (err) {
    console.error("[email-digest] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
