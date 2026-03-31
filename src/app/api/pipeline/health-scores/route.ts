import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

/**
 * Recalculate health scores for all contacts using real Odoo + email data.
 *
 * Scores (0-100):
 * - communication_score: based on email volume, response time, recency
 * - financial_score: based on payment compliance, overdue amounts
 * - sentiment_score: from email analysis sentiment data
 * - responsiveness_score: avg response time vs peers
 * - engagement_score: interaction frequency and diversity
 * - overall_score: weighted average of all components
 */
export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const supabase = getServiceClient();
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();

    // 1. Get all external contacts with company info
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, email, name, company_id, sentiment_score, avg_response_time_hours, total_sent, total_received, last_activity, interaction_count")
      .eq("contact_type", "external");

    if (!contacts?.length) {
      return NextResponse.json({ success: true, message: "No contacts", scores: 0 });
    }

    // 2. Get invoice data grouped by company
    const { data: invoices } = await supabase
      .from("odoo_invoices")
      .select("company_id, amount_total, amount_residual, days_overdue, payment_state")
      .eq("move_type", "out_invoice");

    // Group invoices by company_id
    const companyFinancials = new Map<number, { total: number; overdue: number; paidCount: number; totalCount: number }>();
    for (const inv of invoices ?? []) {
      if (!inv.company_id) continue;
      if (!companyFinancials.has(inv.company_id)) {
        companyFinancials.set(inv.company_id, { total: 0, overdue: 0, paidCount: 0, totalCount: 0 });
      }
      const cf = companyFinancials.get(inv.company_id)!;
      cf.total += inv.amount_total ?? 0;
      cf.overdue += inv.days_overdue > 0 ? (inv.amount_residual ?? 0) : 0;
      cf.totalCount++;
      if (inv.payment_state === "paid" || inv.payment_state === "in_payment") cf.paidCount++;
    }

    // 3. Get recent email activity per contact
    const { data: recentEmails } = await supabase
      .from("emails")
      .select("sender_contact_id, email_date")
      .gte("email_date", thirtyDaysAgo)
      .not("sender_contact_id", "is", null);

    const contactRecentEmails = new Map<number, number>();
    for (const e of recentEmails ?? []) {
      if (!e.sender_contact_id) continue;
      contactRecentEmails.set(e.sender_contact_id, (contactRecentEmails.get(e.sender_contact_id) ?? 0) + 1);
    }

    // 4. Calculate scores for each contact
    const scores: Record<string, unknown>[] = [];
    let updated = 0;

    // Get peer averages for normalization
    const avgResponseTime = contacts.reduce((s, c) => s + (c.avg_response_time_hours ?? 48), 0) / contacts.length;
    const avgInteractions = contacts.reduce((s, c) => s + (c.interaction_count ?? 0), 0) / contacts.length;

    for (const contact of contacts) {
      // Communication Score (0-100)
      // Based on: email volume, recency of activity, response patterns
      let commScore = 50; // baseline
      const recentCount = contactRecentEmails.get(contact.id) ?? 0;
      if (recentCount > 10) commScore += 25;
      else if (recentCount > 5) commScore += 15;
      else if (recentCount > 0) commScore += 5;
      else commScore -= 20; // no recent emails = bad sign

      // Recency bonus/penalty
      if (contact.last_activity) {
        const daysSince = (now.getTime() - new Date(contact.last_activity).getTime()) / 86400_000;
        if (daysSince < 3) commScore += 15;
        else if (daysSince < 7) commScore += 10;
        else if (daysSince < 14) commScore += 0;
        else if (daysSince < 30) commScore -= 10;
        else commScore -= 25;
      } else {
        commScore -= 15;
      }

      // Volume bonus
      const totalEmails = (contact.total_sent ?? 0) + (contact.total_received ?? 0);
      if (totalEmails > 50) commScore += 10;
      else if (totalEmails > 20) commScore += 5;

      commScore = clamp(commScore, 0, 100);

      // Financial Score (0-100)
      let finScore = 50; // baseline (no data = neutral)
      if (contact.company_id && companyFinancials.has(contact.company_id)) {
        const cf = companyFinancials.get(contact.company_id)!;
        const complianceRate = cf.totalCount > 0 ? cf.paidCount / cf.totalCount : 0;
        const overdueRatio = cf.total > 0 ? cf.overdue / cf.total : 0;

        finScore = Math.round(complianceRate * 60 + 40); // 40-100 based on payment rate
        if (overdueRatio > 0.5) finScore -= 30;
        else if (overdueRatio > 0.2) finScore -= 15;
        else if (overdueRatio > 0.05) finScore -= 5;
        else if (overdueRatio === 0) finScore += 10;
      }
      finScore = clamp(finScore, 0, 100);

      // Sentiment Score (0-100)
      // Convert from -1..1 range to 0..100
      let sentScore = 50;
      if (contact.sentiment_score != null) {
        sentScore = Math.round((contact.sentiment_score + 1) * 50); // -1→0, 0→50, 1→100
      }
      sentScore = clamp(sentScore, 0, 100);

      // Responsiveness Score (0-100)
      let respScore = 50;
      if (contact.avg_response_time_hours != null) {
        if (contact.avg_response_time_hours < 4) respScore = 95;
        else if (contact.avg_response_time_hours < 12) respScore = 80;
        else if (contact.avg_response_time_hours < 24) respScore = 65;
        else if (contact.avg_response_time_hours < 48) respScore = 50;
        else if (contact.avg_response_time_hours < 96) respScore = 30;
        else respScore = 15;
      }

      // Engagement Score (0-100)
      let engScore = 50;
      const interactionNorm = avgInteractions > 0 ? (contact.interaction_count ?? 0) / avgInteractions : 0;
      if (interactionNorm > 2) engScore = 90;
      else if (interactionNorm > 1.5) engScore = 80;
      else if (interactionNorm > 1) engScore = 65;
      else if (interactionNorm > 0.5) engScore = 50;
      else if (interactionNorm > 0.2) engScore = 35;
      else engScore = 20;

      // Overall Score (weighted)
      const overall = Math.round(
        commScore * 0.25 +
        finScore * 0.25 +
        sentScore * 0.15 +
        respScore * 0.15 +
        engScore * 0.20
      );

      // Determine trend by comparing with most recent previous score
      let trend = "stable";
      const { data: prevScore } = await supabase
        .from("health_scores")
        .select("overall_score")
        .eq("contact_id", contact.id)
        .order("score_date", { ascending: false })
        .limit(1)
        .single();

      if (prevScore?.overall_score != null) {
        const delta = overall - prevScore.overall_score;
        if (delta >= 5) trend = "improving";
        else if (delta <= -5) trend = "declining";
      }

      // Determine risk level
      let riskLevel = "low";
      if (overall < 30) riskLevel = "critical";
      else if (overall < 45) riskLevel = "high";
      else if (overall < 60) riskLevel = "medium";

      scores.push({
        contact_id: contact.id,
        contact_email: contact.email,
        company_id: contact.company_id,
        score_date: today,
        overall_score: overall,
        previous_score: prevScore?.overall_score ?? null,
        trend,
        communication_score: commScore,
        financial_score: finScore,
        sentiment_score: sentScore,
        responsiveness_score: respScore,
        engagement_score: engScore,
      });

      // Also update contact's cached health fields
      await supabase
        .from("contacts")
        .update({
          current_health_score: overall,
          health_trend: trend,
          risk_level: riskLevel,
        })
        .eq("id", contact.id);

      updated++;
    }

    // Batch insert scores
    for (let i = 0; i < scores.length; i += 100) {
      const chunk = scores.slice(i, i + 100);
      await supabase.from("health_scores").upsert(chunk, { onConflict: "contact_id,score_date" });
    }

    // Log
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "health_scores",
      message: `Recalculated ${updated} health scores`,
      details: { contacts: updated },
    });

    return NextResponse.json({
      success: true,
      scores_updated: updated,
      message: `${updated} health scores recalculated with real data`,
    });
  } catch (err) {
    console.error("[health-scores] Error:", err);
    return NextResponse.json({ error: "Error calculando health scores", detail: String(err) }, { status: 500 });
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
