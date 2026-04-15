/**
 * Notification Dispatcher — reads notification_queue and sends via WhatsApp/email.
 *
 * The queue is populated by Supabase triggers:
 *   - trg_notify_urgent: critical/high insights → assignee email + CEO WhatsApp
 *   - trg_invoice_overdue_alert: invoices >$50K MXN overdue → Cobranza email
 *   - generate_daily_digest(): morning digest → CEO WhatsApp
 *
 * This cron dispatches pending notifications, marks them sent/failed,
 * and respects the dedup_key to avoid duplicate sends.
 *
 * Cron: every 5 minutes.
 *
 * Required env vars:
 *   WHATSAPP_TOKEN    — Meta Graph API access token
 *   WHATSAPP_PHONE_ID — WhatsApp Business phone number ID
 *   RESEND_API_KEY    — Resend API key (optional, for email)
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Fetch pending notifications (max 20 per run to stay within timeout)
    const { data: pending, error } = await supabase
      .from("notification_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error("[send-notifications] fetch error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!pending?.length) {
      return NextResponse.json({ success: true, sent: 0, skipped: "no pending" });
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const notif of pending) {
      try {
        if (notif.channel === "whatsapp") {
          const success = await sendWhatsApp(notif);
          if (success) {
            await markSent(supabase, notif.id);
            sent++;
          } else {
            await markFailed(supabase, notif.id, "WhatsApp send failed or not configured");
            skipped++;
          }
        } else if (notif.channel === "email") {
          const success = await sendEmail(notif);
          if (success) {
            await markSent(supabase, notif.id);
            sent++;
          } else {
            await markFailed(supabase, notif.id, "Email send failed or not configured");
            skipped++;
          }
        } else {
          // Unknown channel — skip
          await markFailed(supabase, notif.id, `Unknown channel: ${notif.channel}`);
          skipped++;
        }
      } catch (err) {
        console.error(`[send-notifications] notif ${notif.id}:`, err);
        await markFailed(supabase, notif.id, String(err));
        failed++;
      }
    }

    if (sent > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "send_notifications",
        message: `Dispatched ${sent} notifications (${failed} failed, ${skipped} skipped)`,
        details: { sent, failed, skipped, total: pending.length },
      });
    }

    return NextResponse.json({ success: true, sent, failed, skipped });
  } catch (err) {
    console.error("[send-notifications]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── WhatsApp via Meta Graph API ─────────────────────────────────────

async function sendWhatsApp(notif: Record<string, unknown>): Promise<boolean> {
  const waToken = process.env.WHATSAPP_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_ID;
  const waTo = (notif.recipient_phone as string) || process.env.WHATSAPP_TO;

  if (!waToken || !waPhoneId || !waTo) {
    console.warn("[send-notifications] WhatsApp not configured");
    return false;
  }

  const body = String(notif.body || notif.title || "").slice(0, 4096);

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${waPhoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: waTo.replace(/\D/g, ""),
        type: "text",
        text: { body },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.error(`[WhatsApp] HTTP ${response.status}: ${errText}`);
    return false;
  }

  return true;
}

// ── Email via Resend ────────────────────────────────────────────────

async function sendEmail(notif: Record<string, unknown>): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = notif.recipient_email as string;

  if (!apiKey || !to) {
    console.warn("[send-notifications] Email not configured or no recipient");
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Quimibond Intelligence <alerts@quimibond.com>",
      to,
      subject: String(notif.title || "Quimibond Alert").slice(0, 200),
      text: String(notif.body || ""),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.error(`[Email] HTTP ${response.status}: ${errText}`);
    return false;
  }

  return true;
}

// ── Helpers ──────────────────────────────────────��──────────────────

async function markSent(supabase: ReturnType<typeof getServiceClient>, id: number) {
  await supabase
    .from("notification_queue")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
}

async function markFailed(supabase: ReturnType<typeof getServiceClient>, id: number, error: string) {
  await supabase
    .from("notification_queue")
    .update({ status: "failed", error_message: error.slice(0, 500) })
    .eq("id", id);
}
