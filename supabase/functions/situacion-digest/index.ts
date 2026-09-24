/**
 * situacion-digest (Edge Function) — el correo diario de situación al director (spec §7.2).
 * Sustituye a email-digest. Una sola fuente: situacion_cambios(p_desde). Claude (Opus) solo
 * escribe "Lo que decidiría hoy"; las listas salen del JSON tal cual (situacion-digest-html.ts).
 *
 * Disparo: pg_cron `situacion_digest` 12:30 UTC (06:30 CDMX). Body opcional:
 *   { "manual": true }       genera y guarda sin mandar correo
 *   { "desde": "<iso>" }     ventana desde esa hora (default: el `hasta` del último digest del cron, o 24 h)
 *   { "sin_ia": true }       sin narrativa (prueba barata)
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody } from "../_shared/env.ts";
import { anthropicClient, claudeText, MODEL_MAIN } from "../_shared/claude.ts";
import { sendMail } from "../_shared/mailer.ts";
import { renderSituacionDigestHtml, renderSituacionDigestText, type Cambios } from "../_shared/situacion-digest-html.ts";
import { SYSTEM, entradaParaClaude } from "./prompt.ts";

const TZ = "America/Mexico_City";
/** Si el último correo del cron tiene menos de estas horas, la ventana arranca en su `hasta` (cubre un día fallido); si no, 24 h. */
const MAX_VENTANA_H = 60;
const LISTAS = ["nuevas", "empeoradas", "mejoradas", "resueltas", "delegadas", "graves"] as const;

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;
  const body = await readBody(req);
  const manual = body.manual === true;
  const trigger = manual ? "manual" : "cron";
  const started = Date.now();

  try {
    // 1. Ventana: desde el `hasta` del último correo del cron si tiene menos de 60 h; si no, 24 h.
    let desde: string | null = typeof body.desde === "string" && body.desde ? body.desde : null;
    if (!desde) {
      const { data: ult, error: ultErr } = await supabase.from("situacion_digests").select("hasta").eq("trigger", "cron").order("hasta", { ascending: false }).limit(1).maybeSingle();
      if (ultErr) throw new Error(`situacion_digests: ${ultErr.message}`);
      const ultimo = ult?.hasta ? Date.parse(String(ult.hasta)) : NaN;
      const reciente = Number.isFinite(ultimo) && ultimo > started - MAX_VENTANA_H * 3600_000;
      desde = new Date(reciente ? ultimo : started - 24 * 3600_000).toISOString();
    }
    const { data: cambios, error } = await supabase.rpc("situacion_cambios", { p_desde: desde });
    if (error) throw new Error(`situacion_cambios: ${error.message}`);
    if (!cambios || typeof cambios !== "object") throw new Error("situacion_cambios devolvió vacío");
    const c = cambios as Cambios;
    const totales = c.totales ?? {};

    // 2. Narrativa (Opus) solo si hubo cambios.
    const hayCambios = LISTAS.some((k) => (totales[k] ?? 0) > 0);
    let narrativa = "";
    let modelo: string | null = null;
    if (hayCambios && body.sin_ia !== true) {
      const client = await anthropicClient(supabase);
      if (!client) throw new Error("anthropic_api_key no configurado (env ni Vault)");
      modelo = MODEL_MAIN;
      narrativa = await claudeText(client, supabase, { model: MODEL_MAIN, system: SYSTEM, user: entradaParaClaude(c), max_tokens: 1200, effort: "medium" }, "situacion-digest");
    }

    // 3. Render y correo.
    const ahora = new Date();
    const dateLabel = ahora.toLocaleDateString("es-MX", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const fecha = ahora.toLocaleDateString("sv-SE", { timeZone: TZ });
    const esLunes = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(ahora) === "Mon";
    const html = renderSituacionDigestHtml({ dateLabel, narrativaMd: narrativa, cambios: c, esLunes });
    const texto = renderSituacionDigestText({ dateLabel, narrativaMd: narrativa, cambios: c, esLunes });
    let emailed = false;
    let emailError: string | null = null;
    if (!manual) {
      const asunto = hayCambios
        ? `🗺️ Situación — ${fecha}: ${totales.empeoradas ?? 0} empeoraron, ${totales.nuevas ?? 0} nuevas, ${totales.graves ?? 0} graves`
        : `🗺️ Situación — ${fecha}: sin cambios`;
      const r = await sendMail(supabase, asunto, texto, html);
      emailed = r.ok;
      emailError = r.error ?? null;
    }

    // 4. Bitácora y log.
    const { error: insErr } = await supabase.from("situacion_digests").insert({
      fecha, desde, hasta: c.hasta, cambios: c, narrativa_md: narrativa || null, emailed, email_error: emailError, trigger, modelo,
    });
    if (insErr) throw new Error(`situacion_digests insert: ${insErr.message}${emailed ? " (el correo sí se mandó)" : ""}`);
    const elapsed_s = Math.round((Date.now() - started) / 1000);
    await pipelineLog(supabase, "situacion_digest", emailError ? "warning" : "info",
      `Situación digest (${trigger}): ${JSON.stringify(totales)} emailed=${emailed}${emailError ? ` — ${emailError}` : ""} (${elapsed_s}s)`,
      { trigger, desde, hasta: c.hasta, totales, emailed, email_error: emailError, modelo, elapsed_s });
    return json({ ok: true, trigger, desde, hasta: c.hasta, totales, emailed, email_error: emailError, modelo, elapsed_s, narrativa, texto });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const elapsed_s = Math.round((Date.now() - started) / 1000);
    console.error("[situacion-digest]", message);
    await pipelineLog(supabase, "situacion_digest", "error", `Situación digest falló (${trigger}): ${message.slice(0, 300)}`, { trigger, elapsed_s });
    return json({ error: message, trigger, elapsed_s }, 500);
  }
});
