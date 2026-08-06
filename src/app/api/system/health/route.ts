/**
 * Watchdog unificado — corre cada hora (Vercel cron).
 *
 * Verifica en un solo lugar TODAS las fuentes de datos:
 *   1. Crons de Vercel (via pipeline_logs, cada phase vs su intervalo esperado)
 *   2. Sync de Odoo (odoo_sync_freshness, 25 tablas)
 *   3. Gmail (edad del último email guardado)
 *   4. Errores recientes a nivel error en pipeline_logs
 *
 * Si hay problemas: loggea phase='watchdog' level='error' (visible en /hoy →
 * salud de datos) e intenta mandar UN correo al CEO (sendAlertEmail; requiere
 * scope gmail.send autorizado — si no, degrada a solo log). Anti-spam: no
 * re-envía si ya alertó los mismos problemas en las últimas 6 horas.
 *
 * Lección del incidente Gmail 2026 (2 meses de sync roto en silencio):
 * ningún pipeline puede fallar sin que se vea en /hoy y llegue un aviso.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { sendAlertEmail } from "@/lib/alerts/send-email";

export const maxDuration = 60;

// phase en pipeline_logs → intervalo esperado en minutos.
// Solo crons vivos post-poda 2026-08-05 (agentes especulativos retirados).
const CRON_INTERVALS: Record<string, number> = {
  emails_synced: 30, // /api/pipeline/sync-emails
  account_analysis: 5, // /api/pipeline/analyze
  auto_fix: 30, // /api/agents/auto-fix
  cleanup_agent: 30, // /api/agents/cleanup
  briefing: 1440, // /api/pipeline/briefing
  reconcile: 1440, // /api/pipeline/reconcile
  embeddings: 15, // /api/pipeline/embeddings
  identity_resolution: 120, // /api/agents/identity-resolution
};

interface Issue {
  kind: "cron_stale" | "odoo_stale" | "gmail_stale" | "pipeline_errors";
  detail: string;
}

export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  // Modo prueba: /api/system/health?test_email=1 (desde el navegador con
  // sesión iniciada) manda un correo de verificación al destinatario del
  // watchdog. Sirve para confirmar que el scope gmail.send está autorizado.
  const url = new URL(request.url);
  if (url.searchParams.get("test_email")) {
    const result = await sendAlertEmail(
      "✅ Prueba de alertas — Quimibond Intelligence",
      [
        "Este es un correo de prueba del watchdog.",
        "",
        "Si lo estás leyendo, el scope gmail.send está autorizado y las",
        "alertas automáticas de salud de datos van a llegar a este buzón.",
      ].join("\n"),
    );
    return NextResponse.json({ test_email: true, ...result });
  }

  const supabase = getServiceClient();
  const now = Date.now();
  const issues: Issue[] = [];

  try {
    // ── 1. Crons de Vercel via pipeline_logs ─────────────────────────────
    // Filtrar a las phases monitoreadas: sin esto, las phases ruidosas
    // empujan a las poco frecuentes fuera de la ventana de muestreo y
    // generan falsos "nunca ha corrido".
    const { data: logs } = await supabase
      .from("pipeline_logs")
      .select("phase, created_at")
      .in("phase", Object.keys(CRON_INTERVALS))
      .order("created_at", { ascending: false })
      .limit(500);

    const latestByPhase = new Map<string, string>();
    for (const log of logs ?? []) {
      const phase = (log.phase ?? "").toLowerCase().replace(/[^a-z_]/g, "_");
      if (!latestByPhase.has(phase)) latestByPhase.set(phase, log.created_at);
    }

    for (const [name, intervalMinutes] of Object.entries(CRON_INTERVALS)) {
      const last = latestByPhase.get(name);
      const minutesAgo = last ? Math.round((now - new Date(last).getTime()) / 60000) : null;
      if (minutesAgo === null || minutesAgo > intervalMinutes * 2.5) {
        issues.push({
          kind: "cron_stale",
          detail: `${name}: ${minutesAgo === null ? "nunca ha corrido" : `${minutesAgo} min sin correr (esperado cada ${intervalMinutes})`}`,
        });
      }
    }

    // ── 2. Sync de Odoo ──────────────────────────────────────────────────
    const { data: freshness } = await supabase
      .from("odoo_sync_freshness")
      .select("table_name, status, hours_ago, expected_hours");

    for (const t of freshness ?? []) {
      const hoursAgo = t.hours_ago == null ? null : Number(t.hours_ago);
      const expected = t.expected_hours == null ? 2 : Number(t.expected_hours);
      if (t.status === "stale" || (hoursAgo != null && hoursAgo > expected * 3)) {
        issues.push({
          kind: "odoo_stale",
          detail: `odoo ${t.table_name}: ${hoursAgo != null ? `${Math.round(hoursAgo)}h` : "?"} sin sync (esperado cada ${expected}h)`,
        });
      }
    }

    // ── 3. Gmail: edad del último email persistido ───────────────────────
    const { data: lastEmail } = await supabase
      .from("emails")
      .select("email_date")
      .order("email_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const emailAgeHours = lastEmail?.email_date
      ? (now - new Date(lastEmail.email_date).getTime()) / 3600000
      : null;
    if (emailAgeHours === null || emailAgeHours > 3) {
      issues.push({
        kind: "gmail_stale",
        detail: `Gmail: último email guardado hace ${emailAgeHours === null ? "?" : Math.round(emailAgeHours)}h (umbral 3h)`,
      });
    }

    // ── 4. Errores recientes (últimas 3h) ────────────────────────────────
    const { data: recentErrors } = await supabase
      .from("pipeline_logs")
      .select("phase, message, created_at")
      .eq("level", "error")
      .neq("phase", "watchdog")
      .gte("created_at", new Date(now - 3 * 3600000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    if ((recentErrors ?? []).length > 0) {
      const phases = [...new Set((recentErrors ?? []).map((e) => e.phase))];
      issues.push({
        kind: "pipeline_errors",
        detail: `${recentErrors!.length} errores en 3h en: ${phases.join(", ")} — primero: "${recentErrors![0].message?.slice(0, 120)}"`,
      });
    }

    const healthy = issues.length === 0;

    // ── Alerta: log + email (con dedup de 6h) ────────────────────────────
    let emailSent = false;
    let emailError: string | null = null;

    if (!healthy) {
      const issueHash = issues
        .map((i) => i.kind + ":" + i.detail.split(":")[0])
        .sort()
        .join("|");

      // Anti-spam: máximo UN correo cada 24h, sin importar si el set de
      // problemas cambió (decisión CEO 2026-08-06 — el hash cambiaba cada
      // hora por detalles menores y llegaba un correo por hora). El estado
      // horario completo sigue visible en /hoy vía el log de abajo.
      const { data: recentAlerts } = await supabase
        .from("pipeline_logs")
        .select("details, created_at")
        .eq("phase", "watchdog")
        .gte("created_at", new Date(now - 24 * 3600000).toISOString())
        .order("created_at", { ascending: false })
        .limit(30);

      const alreadyAlerted = (recentAlerts ?? []).some(
        (a) => (a.details as { email_sent?: boolean } | null)?.email_sent === true,
      );

      if (!alreadyAlerted) {
        const body = [
          `El watchdog de Quimibond Intelligence detectó ${issues.length} problema(s):`,
          "",
          ...issues.map((i) => `• [${i.kind}] ${i.detail}`),
          "",
          `Detalle: https://quimibond-intelligence.vercel.app/hoy`,
          `Sistema: https://quimibond-intelligence.vercel.app/sistema`,
        ].join("\n");

        const result = await sendAlertEmail(
          `⚠️ Quimibond Intelligence: ${issues.length} problema(s) de datos`,
          body,
        );
        emailSent = result.ok;
        emailError = result.error ?? null;
      }

      await supabase.from("pipeline_logs").insert({
        level: "error",
        phase: "watchdog",
        message: `Watchdog: ${issues.length} problemas — ${issues.map((i) => i.kind).join(", ")}`,
        details: {
          issues: issues.map((i) => i.detail),
          issue_hash: issueHash,
          email_sent: emailSent,
          email_error: emailError,
          deduped: alreadyAlerted,
        },
      });
    }

    return NextResponse.json({
      healthy,
      issues,
      email_sent: emailSent,
      email_error: emailError,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[watchdog] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
