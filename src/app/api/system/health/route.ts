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

  const supabase = getServiceClient();
  const now = Date.now();
  const issues: Issue[] = [];

  try {
    // ── 1. Crons de Vercel via pipeline_logs ─────────────────────────────
    const { data: logs } = await supabase
      .from("pipeline_logs")
      .select("phase, created_at")
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

      const { data: lastAlert } = await supabase
        .from("pipeline_logs")
        .select("details, created_at")
        .eq("phase", "watchdog")
        .gte("created_at", new Date(now - 6 * 3600000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const alreadyAlerted =
        (lastAlert?.details as { issue_hash?: string } | null)?.issue_hash === issueHash;

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
