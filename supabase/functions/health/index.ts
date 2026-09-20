/**
 * health (Edge Function) — watchdog unificado, cada hora (pg_cron
 * `memoria_watchdog`). Reemplaza a /api/system/health de Vercel.
 *
 * Revisa en un solo lugar:
 *   1. Jobs pg_cron memoria_* (última corrida exitosa vs intervalo esperado,
 *      vía RPC memoria_cron_health) — antes eran los crons de Vercel.
 *   2. Sync de Odoo: solo contactos/empresas (odoo_push_last_events,
 *      método 'contacts'), que es lo único que la memoria consume desde
 *      2026-09-17. El SAT vive en Odoo (addon quimibond_sat de qb19) y
 *      desde 2026-09-18 Supabase solo guarda la memoria de correo.
 *   3. Gmail (edad del último correo guardado).
 *   4. Errores level=error en pipeline_logs (3 h).
 *   5. Situación de la empresa: push de señales de Odoo y última corrida del
 *      bot situacion-consolidar; lo que ve entra al mapa como señal job_caido.
 *
 * Si hay problemas: log phase='watchdog' level='error' y UN correo al CEO
 * como máximo cada 24 h (sendMail; requiere scope gmail.send — si no,
 * degrada a solo log). Body { "test_email": true } manda un correo de prueba.
 */
import { serviceClient, authorizeCron, json, readBody } from "../_shared/env.ts";
import { sendMail, mailDefaults } from "../_shared/mailer.ts";

// job pg_cron → intervalo esperado en minutos entre corridas exitosas.
const JOB_INTERVALS: Record<string, number> = {
  memoria_sync_emails: 30,
  memoria_attachments_extract: 2,
  memoria_backfill_sweep: 1, // solo se exige mientras haya cuentas pendientes (desprogramado 2026-09-18: backfill 52/52 terminado)
  memoria_watchdog: 60,
};

interface Issue {
  kind: "cron_stale" | "cron_failing" | "odoo_stale" | "gmail_stale" | "pipeline_errors";
  detail: string;
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const body = await readBody(req);
  if (body.test_email === true) {
    const r = await sendMail(
      supabase,
      "✅ Prueba de alertas — Quimibond Intelligence (Edge)",
      ["Este es un correo de prueba del watchdog en Supabase Edge Functions.", "", "Si lo estás leyendo, el scope gmail.send está autorizado y las alertas de salud de datos van a llegar a este buzón."].join("\n"),
    );
    return json({ test_email: true, ...r, ...mailDefaults() });
  }

  const now = Date.now();
  const issues: Issue[] = [];

  // 1. Jobs pg_cron
  const { data: jobs, error: jobsErr } = await supabase.rpc("memoria_cron_health");
  if (jobsErr) issues.push({ kind: "cron_failing", detail: `memoria_cron_health: ${jobsErr.message}` });
  const { count: backfillPending } = await supabase.from("email_backfill_state").select("account", { count: "exact", head: true }).eq("done", false);
  const byName = new Map<string, { active: boolean; last_ok: string | null; last_run: string | null; failures_3h: number }>();
  for (const j of (jobs ?? []) as { jobname: string; active: boolean; last_ok: string | null; last_run: string | null; failures_3h: number }[]) byName.set(j.jobname, j);
  for (const [name, interval] of Object.entries(JOB_INTERVALS)) {
    if (name === "memoria_backfill_sweep" && !(backfillPending ?? 0)) continue;
    const j = byName.get(name);
    if (!j) {
      issues.push({ kind: "cron_stale", detail: `${name}: job no existe` });
      continue;
    }
    if (!j.active) {
      issues.push({ kind: "cron_stale", detail: `${name}: job desactivado` });
      continue;
    }
    if (!j.last_run) continue; // recién programado, aún no le toca (p.ej. el diario)
    const minutesAgo = j.last_ok ? Math.round((now - new Date(j.last_ok).getTime()) / 60000) : null;
    if (minutesAgo === null || minutesAgo > Math.max(interval * 2.5, 15)) {
      issues.push({ kind: "cron_stale", detail: `${name}: ${minutesAgo === null ? "nunca ha corrido bien" : `${minutesAgo} min sin corrida exitosa (esperado cada ${interval})`}` });
    }
    if ((j.failures_3h ?? 0) >= 3) {
      issues.push({ kind: "cron_failing", detail: `${name}: ${j.failures_3h} corridas fallidas en 3h` });
    }
  }

  // 2. Odoo: el push horario de qb19 solo manda contactos/empresas (push_models=contacts).
  const { data: lastPush } = await supabase
    .from("odoo_push_last_events")
    .select("created_at")
    .eq("method", "contacts")
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pushAgeHours = lastPush?.created_at ? (now - new Date(lastPush.created_at).getTime()) / 3600000 : null;
  if (pushAgeHours === null || pushAgeHours > 6) {
    issues.push({ kind: "odoo_stale", detail: `odoo contacts: ${pushAgeHours === null ? "?" : Math.round(pushAgeHours)}h sin push exitoso (esperado cada 1h, umbral 6h)` });
  }

  // 2b. Push de señales de Odoo (cada hora; umbral 3 h) y última corrida terminada del bot de situaciones (umbral 3 h).
  //     situacion_respaldo no va en JOB_INTERVALS porque corre condicional (solo si no hubo corrida en 50 min).
  const { data: lastSenales } = await supabase.from("odoo_push_last_events").select("created_at").eq("method", "senales").eq("status", "success")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const senalesAgeH = lastSenales?.created_at ? (now - new Date(lastSenales.created_at).getTime()) / 3600000 : null;
  if (senalesAgeH === null || senalesAgeH > 3) {
    issues.push({ kind: "odoo_stale", detail: `odoo senales: ${senalesAgeH === null ? "?" : Math.round(senalesAgeH)}h sin push exitoso (esperado cada 1h, umbral 3h)` });
  }
  const { data: lastRun } = await supabase.from("situacion_corridas").select("terminada_en").not("terminada_en", "is", null)
    .order("terminada_en", { ascending: false }).limit(1).maybeSingle();
  const botAgeH = lastRun?.terminada_en ? (now - new Date(lastRun.terminada_en).getTime()) / 3600000 : null;
  if (botAgeH === null || botAgeH > 3) {
    issues.push({ kind: "cron_stale", detail: `situacion-consolidar: ${botAgeH === null ? "nunca ha terminado" : Math.round(botAgeH) + "h sin corrida terminada"} (umbral 3h)` });
  }

  // 3. Gmail
  const { data: lastEmail } = await supabase.from("emails").select("email_date").order("email_date", { ascending: false }).limit(1).maybeSingle();
  const emailAgeHours = lastEmail?.email_date ? (now - new Date(lastEmail.email_date).getTime()) / 3600000 : null;
  if (emailAgeHours === null || emailAgeHours > 3) {
    issues.push({ kind: "gmail_stale", detail: `Gmail: último email guardado hace ${emailAgeHours === null ? "?" : Math.round(emailAgeHours)}h (umbral 3h)` });
  }

  // 4. Errores recientes
  const { data: recentErrors } = await supabase
    .from("pipeline_logs")
    .select("phase, message, created_at")
    .eq("level", "error")
    .neq("phase", "watchdog")
    .gte("created_at", new Date(now - 3 * 3600000).toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  const errs = (recentErrors ?? []) as { phase: string; message: string | null }[];
  if (errs.length > 0) {
    const phases = [...new Set(errs.map((e) => e.phase))];
    issues.push({ kind: "pipeline_errors", detail: `${errs.length} errores en 3h en: ${phases.join(", ")} — primero: "${errs[0].message?.slice(0, 120)}"` });
  }

  // 5. Situación: lo que el watchdog ve entra al mapa como señal job_caido (fuente watchdog), lista completa (vacía = todo resuelto).
  const filas = issues.filter((i) => i.kind !== "pipeline_errors").map((i) => ({
    clave: `job_caido:${i.kind}:${i.detail.split(":")[0].trim().replace(/\s+/g, "_").slice(0, 60)}`,
    valor: 1, valor_texto: i.detail.slice(0, 300), payload: { kind: i.kind },
  }));
  const { data: lote, error: loteErr } = await supabase.rpc("senales_ingestar", { p_senal: "job_caido", p_fuente: "watchdog", p_corrida: crypto.randomUUID(), p_filas: filas });
  if (loteErr || !(lote as { ok?: boolean })?.ok) console.warn("[health] senales_ingestar job_caido", loteErr?.message ?? lote);

  const healthy = issues.length === 0;
  let emailSent = false;
  let emailError: string | null = null;
  let deduped = false;

  if (!healthy) {
    const { data: recentAlerts } = await supabase
      .from("pipeline_logs")
      .select("details, created_at")
      .eq("phase", "watchdog")
      .gte("created_at", new Date(now - 24 * 3600000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30);
    deduped = ((recentAlerts ?? []) as { details: { email_sent?: boolean } | null }[]).some((a) => a.details?.email_sent === true);

    if (!deduped) {
      const text = [
        `El watchdog de Quimibond Intelligence detectó ${issues.length} problema(s):`,
        "",
        ...issues.map((i) => `• [${i.kind}] ${i.detail}`),
        "",
        "Detalle: tabla pipeline_logs (phase=watchdog) en Supabase, o pregúntale a Claude por MCP.",
      ].join("\n");
      const r = await sendMail(supabase, `⚠️ Quimibond Intelligence: ${issues.length} problema(s) de datos`, text);
      emailSent = r.ok;
      emailError = r.error ?? null;
    }

    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "watchdog",
      message: `Watchdog: ${issues.length} problemas — ${issues.map((i) => i.kind).join(", ")}`,
      details: { issues: issues.map((i) => i.detail), email_sent: emailSent, email_error: emailError, deduped, runtime: "edge" },
    });
  } else {
    await supabase.from("pipeline_logs").insert({ level: "info", phase: "watchdog", message: "Watchdog: todo en orden", details: { runtime: "edge" } });
  }

  return json({ healthy, issues, email_sent: emailSent, email_error: emailError, deduped, checked_at: new Date().toISOString() });
});
