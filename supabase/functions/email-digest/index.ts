/**
 * email-digest (Edge Function) — resumen ejecutivo del correo de las últimas
 * 24 h para el CEO, generado con Claude, guardado en email_digests y enviado
 * por correo (HTML de _shared/digest-email-html.ts). Reemplaza a
 * /api/pipeline/email-digest de Vercel.
 *
 * Disparo: pg_cron `memoria_email_digest` 12:45 UTC (6:45 CDMX).
 * Body { "manual": true } genera sin mandar correo (para pruebas).
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody } from "../_shared/env.ts";
import { anthropicClient, claudeText, MODEL_MAIN } from "../_shared/claude.ts";
import { sendMail } from "../_shared/mailer.ts";
import { renderDigestEmailHtml, type PendingActionRow, type UnansweredThreadRow, type SilentCustomerRow } from "../_shared/digest-email-html.ts";

const SYSTEM = `Eres el asistente ejecutivo del CEO de Quimibond (textil, México). Escribe el resumen del correo de las últimas 24 horas, en español, en markdown, máximo ~400 palabras. Estructura:

## Lo más importante
3-6 bullets con lo que el CEO debe saber o decidir HOY (RFQs, urgencias, quejas, montos). Cita cliente y buzón.

## Por cliente
Solo clientes con actividad relevante (agrupa; ignora rutina como confirmaciones de entrega normales, notificaciones automáticas y facturas de trámite).

## Pendientes y silencios
Compromisos con deadline próximo y clientes importantes sin respuesta o callados.

Reglas: solo hechos que estén en los datos; no inventes nada; sé concreto (nombres, montos, fechas). Si el día estuvo tranquilo, dilo en una línea y no rellenes.`;

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const client = await anthropicClient(supabase);
  if (!client) {
    await pipelineLog(supabase, "email_digest", "error", "Digest: anthropic_api_key no configurado (env ni Vault)");
    return json({ error: "anthropic_api_key no configurado" }, 503);
  }
  const body = await readBody(req);
  const isManual = body.manual === true;

  try {
    const [emailsRes, pendingRes, unansweredRes, silentRes] = await Promise.all([
      supabase.rpc("analyst_query", {
        p_sql: `SELECT c.name AS cliente, e.sender, e.subject, left(coalesce(e.body_clean, e.snippet, e.body), 220) AS resumen,
            e.account AS buzon, to_char(e.email_date AT TIME ZONE 'America/Mexico_City', 'DD/MM HH24:MI') AS fecha
          FROM emails e
          JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
          WHERE e.sender_type = 'external'
            AND e.email_date > now() - interval '24 hours'
            AND e.sender !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|donotreply)'
          ORDER BY c.lifetime_value DESC, e.email_date DESC
          LIMIT 80`,
      }),
      supabase.from("email_pending_actions").select("tipo, descripcion, deadline, company_name, account").eq("status", "open").order("deadline", { ascending: true, nullsFirst: false }).limit(15),
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

    const contentMd = await claudeText(client, supabase, { model: MODEL_MAIN, system: SYSTEM, user: `Datos de las últimas 24h:\n${input}`, max_tokens: 2000, effort: "medium" }, "email-digest");

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
    const pendientes = (pendingRes.data ?? []) as PendingActionRow[];
    const hilos = (Array.isArray(unansweredRes.data) ? unansweredRes.data : []) as UnansweredThreadRow[];
    const callados = (Array.isArray(silentRes.data) ? silentRes.data : []) as SilentCustomerRow[];
    const stats = { correos_externos_24h: correos.length, pendientes: pendientes.length, sin_respuesta: hilos.length, clientes_callados: callados.length };

    let emailed = false;
    let emailError: string | null = null;
    if (!isManual) {
      const dateLabel = new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const html = renderDigestEmailHtml({ dateLabel, contentMd, stats, pendientes, hilosSinRespuesta: hilos, clientesCallados: callados });
      const r = await sendMail(supabase, `📬 Resumen de correo — ${today}`, contentMd, html);
      emailed = r.ok;
      emailError = r.error ?? null;
    }

    await supabase.from("email_digests").insert({ digest_date: today, content_md: contentMd, stats, trigger: isManual ? "manual" : "cron", emailed });
    await pipelineLog(supabase, "email_digest", emailError ? "warning" : "info", `Resumen de correo generado (${isManual ? "manual" : "cron"}): ${correos.length} correos, emailed=${emailed}${emailError ? ` — ${emailError}` : ""}`, stats);
    return json({ ok: true, emailed, email_error: emailError, stats, content_md: contentMd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-digest]", message);
    await pipelineLog(supabase, "email_digest", "error", `Digest falló: ${message.slice(0, 300)}`);
    return json({ error: message }, 500);
  }
});
