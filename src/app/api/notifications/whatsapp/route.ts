/**
 * WhatsApp Daily Digest — Sends top insights to the CEO via WhatsApp Cloud API.
 *
 * Runs at 7:00am daily (after briefing at 6:30am).
 * Sends ONLY if there are critical/high insights pending action.
 * No spam — max 1 message per day.
 *
 * Required env vars:
 *   WHATSAPP_TOKEN       — Meta Graph API access token
 *   WHATSAPP_PHONE_ID    — WhatsApp Business phone number ID
 *   WHATSAPP_TO          — CEO phone number with country code (e.g., 5215512345678)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const waToken = process.env.WHATSAPP_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_ID;
  const waTo = process.env.WHATSAPP_TO;

  if (!waToken || !waPhoneId || !waTo) {
    return NextResponse.json({
      error: "WhatsApp not configured. Set WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TO.",
    }, { status: 503 });
  }  const supabase = getServiceClient();

  try {
    // Check if we already sent today (prevent duplicates)
    const today = new Date().toISOString().split("T")[0];
    const { data: alreadySent } = await supabase
      .from("pipeline_logs")
      .select("id")
      .eq("phase", "whatsapp_digest")
      .gte("created_at", `${today}T00:00:00Z`)
      .limit(1);

    if (alreadySent?.length) {
      return NextResponse.json({ success: true, skipped: true, reason: "Already sent today" });
    }

    // Get pending critical/high insights
    const { data: insights } = await supabase
      .from("agent_insights")
      .select("title, severity, category, assignee_name, company_id, recommendation, business_impact_estimate")
      .in("state", ["new", "seen"])
      .gte("confidence", 0.80)
      .in("severity", ["critical", "high"])
      .order("severity", { ascending: true }) // critical first
      .order("created_at", { ascending: false })
      .limit(5);

    if (!insights?.length) {
      // Log but don't send — nothing urgent
      await supabase.from("pipeline_logs").insert({
        level: "debug",
        phase: "whatsapp_digest",
        message: "No critical/high insights to send",
      });
      return NextResponse.json({ success: true, skipped: true, reason: "No urgent insights" });
    }

    // Get today's briefing summary
    const { data: briefing } = await supabase
      .from("briefings")
      .select("summary_text")
      .eq("scope", "daily")
      .eq("briefing_date", today)
      .limit(1)
      .single();

    // Format message
    const message = formatWhatsAppMessage(insights, briefing?.summary_text);

    // Send via WhatsApp Cloud API
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
          to: waTo,
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("[whatsapp] API error:", error);
      await supabase.from("pipeline_logs").insert({
        level: "error",
        phase: "whatsapp_digest",
        message: `WhatsApp send failed: ${response.status}`,
        details: { error: error.slice(0, 500) },
      });
      return NextResponse.json({ error: "WhatsApp send failed", details: error }, { status: 502 });
    }

    const result = await response.json();

    // Log success
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "whatsapp_digest",
      message: `WhatsApp digest sent: ${insights.length} insights`,
      details: { insights_count: insights.length, message_id: result.messages?.[0]?.id },
    });

    return NextResponse.json({
      success: true,
      sent: true,
      insights_count: insights.length,
      message_id: result.messages?.[0]?.id,
    });
  } catch (err) {
    console.error("[whatsapp] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Format message for WhatsApp ─────────────────────────────────────────

interface InsightRow {
  title: string;
  severity: string;
  category: string;
  assignee_name: string | null;
  company_id: number | null;
  recommendation: string | null;
  business_impact_estimate: number | null;
}

function formatWhatsAppMessage(insights: InsightRow[], briefingSummary?: string | null): string {
  const severityIcon: Record<string, string> = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "⚪",
  };

  const lines: string[] = [];

  // Header
  const criticalCount = insights.filter(i => i.severity === "critical").length;
  if (criticalCount > 0) {
    lines.push(`🔴 *${criticalCount} CRÍTICO${criticalCount > 1 ? "S" : ""}* + ${insights.length - criticalCount} importante${insights.length - criticalCount !== 1 ? "s" : ""}`);
  } else {
    lines.push(`🟠 *${insights.length} insight${insights.length > 1 ? "s" : ""} importante${insights.length > 1 ? "s" : ""}*`);
  }
  lines.push("");

  // Insights
  for (const insight of insights) {
    const icon = severityIcon[insight.severity] ?? "⚪";
    lines.push(`${icon} *${insight.title}*`);
    if (insight.recommendation) {
      lines.push(`→ ${insight.recommendation.slice(0, 120)}`);
    }
    if (insight.assignee_name) {
      lines.push(`📋 ${insight.assignee_name}`);
    }
    lines.push("");
  }

  // Briefing snippet
  if (briefingSummary) {
    const snippet = briefingSummary.slice(0, 200);
    lines.push(`📊 *Briefing:* ${snippet}${briefingSummary.length > 200 ? "..." : ""}`);
    lines.push("");
  }

  // CTA
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://quimibond-intelligence.vercel.app";
  lines.push(`👉 ${appUrl}/inbox`);

  return lines.join("\n");
}
