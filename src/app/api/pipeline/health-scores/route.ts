import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

/**
 * Health Scores v2 — Company-level health scoring with real Odoo data.
 *
 * Redesigned from v1 which scored per-contact (wrong unit of analysis).
 * Business relationships are at the COMPANY level — that's what matters.
 *
 * Components (0-100 each):
 * - financial_score: payment compliance, overdue ratio, credit risk
 * - commercial_score: revenue trend, order frequency, order value
 * - operational_score: delivery OTD, returns, complaints
 * - communication_score: email activity, response time, recency
 * - overall_score: weighted average
 *
 * Runs every 6h via cron. Writes to health_scores with company_id.
 * Also updates contacts.current_health_score for their company.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const supabase = getServiceClient();
    const today = new Date().toISOString().split("T")[0];

    // Load all data in parallel (batch, no N+1)
    const [companiesRes, invoicesRes, ordersRes, deliveriesRes, emailsRes, paymentsRes] = await Promise.all([
      supabase.from("company_profile")
        .select("company_id, name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_deliveries, late_deliveries, otd_rate, email_count, last_email_date, contact_count, tier"),

      supabase.from("odoo_invoices")
        .select("company_id, amount_total_mxn, amount_residual_mxn, payment_state, days_overdue")
        .eq("move_type", "out_invoice").eq("state", "posted"),

      supabase.from("odoo_sale_orders")
        .select("company_id, amount_total_mxn, date_order")
        .in("state", ["sale", "done"]),

      supabase.from("odoo_deliveries")
        .select("company_id, state, is_late")
        .not("state", "in", '("cancel")'),

      supabase.from("emails")
        .select("company_id, email_date, sender_type")
        .not("company_id", "is", null)
        .gte("email_date", new Date(Date.now() - 90 * 86400_000).toISOString()),

      supabase.from("odoo_account_payments")
        .select("company_id, amount, date")
        .eq("payment_type", "inbound"),
    ]);

    const companies = companiesRes.data ?? [];
    if (!companies.length) {
      return NextResponse.json({ success: true, message: "No companies in profile", scores: 0 });
    }

    // Build maps for fast lookup
    const invoiceMap = groupBy(invoicesRes.data ?? [], "company_id");
    const orderMap = groupBy(ordersRes.data ?? [], "company_id");
    const deliveryMap = groupBy(deliveriesRes.data ?? [], "company_id");
    const emailMap = groupBy(emailsRes.data ?? [], "company_id");
    const paymentMap = groupBy(paymentsRes.data ?? [], "company_id");

    // Get previous scores for trend calculation
    const { data: prevScores } = await supabase
      .from("health_scores")
      .select("company_id, overall_score")
      .eq("score_date", new Date(Date.now() - 86400_000 * 7).toISOString().split("T")[0]);

    const prevScoreMap = new Map<number, number>();
    for (const s of prevScores ?? []) {
      if (s.company_id) prevScoreMap.set(s.company_id, s.overall_score);
    }

    // Calculate scores
    const scores: Record<string, unknown>[] = [];

    for (const co of companies) {
      const cid = co.company_id;
      const invs = invoiceMap.get(cid) ?? [];
      const ords = orderMap.get(cid) ?? [];
      const dels = deliveryMap.get(cid) ?? [];
      const emls = emailMap.get(cid) ?? [];
      const pmts = paymentMap.get(cid) ?? [];

      // ── Financial Score ──
      let finScore = 50;
      if (invs.length > 0) {
        const paidCount = invs.filter(i => i.payment_state === "paid" || i.payment_state === "in_payment").length;
        const complianceRate = paidCount / invs.length;
        finScore = Math.round(complianceRate * 60 + 30); // 30-90

        const overdueRatio = co.total_revenue > 0 ? (co.overdue_amount ?? 0) / co.total_revenue : 0;
        if (overdueRatio > 0.3) finScore -= 25;
        else if (overdueRatio > 0.15) finScore -= 15;
        else if (overdueRatio > 0.05) finScore -= 5;
        else if (overdueRatio === 0) finScore += 10;

        if ((co.max_days_overdue ?? 0) > 120) finScore -= 15;
        else if ((co.max_days_overdue ?? 0) > 60) finScore -= 10;
      }

      // ── Commercial Score ──
      let commScore = 50;
      const trendPct = co.trend_pct ?? 0;
      if (trendPct > 20) commScore += 25;
      else if (trendPct > 5) commScore += 15;
      else if (trendPct > -5) commScore += 0;
      else if (trendPct > -20) commScore -= 15;
      else commScore -= 25;

      // Order frequency: how many orders in last 6 months
      const sixMonthsAgo = new Date(Date.now() - 180 * 86400_000).toISOString().split("T")[0];
      const recentOrders = ords.filter(o => o.date_order >= sixMonthsAgo);
      if (recentOrders.length > 10) commScore += 15;
      else if (recentOrders.length > 5) commScore += 10;
      else if (recentOrders.length > 0) commScore += 0;
      else commScore -= 20;

      // ── Operational Score ──
      let opsScore = 50;
      const otdRate = co.otd_rate;
      if (otdRate != null) {
        if (otdRate >= 95) opsScore += 25;
        else if (otdRate >= 90) opsScore += 15;
        else if (otdRate >= 80) opsScore += 5;
        else if (otdRate >= 70) opsScore -= 10;
        else opsScore -= 25;
      }
      if ((co.late_deliveries ?? 0) > 5) opsScore -= 15;
      else if ((co.late_deliveries ?? 0) > 0) opsScore -= 5;

      // ── Communication Score ──
      let emailScore = 50;
      const externalEmails = emls.filter(e => e.sender_type === "external").length;
      const internalEmails = emls.filter(e => e.sender_type === "internal").length;
      const totalEmails = emls.length;

      if (totalEmails > 20) emailScore += 20;
      else if (totalEmails > 10) emailScore += 10;
      else if (totalEmails > 3) emailScore += 0;
      else emailScore -= 15;

      // Bidirectional communication is healthy
      if (externalEmails > 0 && internalEmails > 0) emailScore += 10;

      // Recency
      if (co.last_email_date) {
        const daysSince = (Date.now() - new Date(co.last_email_date).getTime()) / 86400_000;
        if (daysSince < 7) emailScore += 10;
        else if (daysSince < 30) emailScore += 0;
        else emailScore -= 15;
      }

      // ── Overall ──
      finScore = clamp(finScore, 0, 100);
      commScore = clamp(commScore, 0, 100);
      opsScore = clamp(opsScore, 0, 100);
      emailScore = clamp(emailScore, 0, 100);

      const overall = Math.round(
        finScore * 0.30 +
        commScore * 0.30 +
        opsScore * 0.20 +
        emailScore * 0.20
      );

      // Trend
      const prevOverall = prevScoreMap.get(cid);
      let trend = "stable";
      if (prevOverall != null) {
        const delta = overall - prevOverall;
        if (delta >= 5) trend = "improving";
        else if (delta <= -5) trend = "declining";
        if (overall < 30) trend = "critical";
      }

      // Risk signals
      const riskSignals: string[] = [];
      if ((co.overdue_amount ?? 0) > 100000) riskSignals.push(`$${Math.round((co.overdue_amount ?? 0) / 1000)}K vencido`);
      if ((co.max_days_overdue ?? 0) > 90) riskSignals.push(`${co.max_days_overdue}d max vencido`);
      if (trendPct < -30) riskSignals.push(`revenue -${Math.abs(trendPct)}%`);
      if ((co.late_deliveries ?? 0) > 3) riskSignals.push(`${co.late_deliveries} entregas tarde`);

      const opportunitySignals: string[] = [];
      if (trendPct > 30) opportunitySignals.push(`crecimiento +${trendPct}%`);
      if (recentOrders.length > 10) opportunitySignals.push(`${recentOrders.length} ordenes en 6m`);
      if (totalEmails > 20 && externalEmails > 10) opportunitySignals.push("comunicacion activa");

      scores.push({
        company_id: cid,
        contact_email: co.name, // use company name as identifier
        score_date: today,
        overall_score: overall,
        previous_score: prevOverall ?? null,
        trend,
        communication_score: emailScore,
        financial_score: finScore,
        sentiment_score: commScore, // repurposed: commercial score
        responsiveness_score: opsScore, // repurposed: operational score
        engagement_score: Math.round((finScore + commScore + opsScore + emailScore) / 4),
        payment_compliance_score: finScore,
        risk_signals: riskSignals.length > 0 ? riskSignals : null,
        opportunity_signals: opportunitySignals.length > 0 ? opportunitySignals : null,
      });
    }

    // Batch upsert
    for (let i = 0; i < scores.length; i += 200) {
      const chunk = scores.slice(i, i + 200);
      await supabase.from("health_scores").upsert(chunk, { onConflict: "contact_id,score_date" });
    }

    // Update contacts with their company's health
    const companyScoreMap = new Map<number, { score: number; trend: string; risk: string }>();
    for (const s of scores) {
      const overall = s.overall_score as number;
      let risk = "low";
      if (overall < 30) risk = "critical";
      else if (overall < 45) risk = "high";
      else if (overall < 60) risk = "medium";
      companyScoreMap.set(s.company_id as number, { score: overall, trend: s.trend as string, risk });
    }

    // Batch update contacts by company
    for (const [companyId, { score, trend, risk }] of companyScoreMap) {
      await supabase.from("contacts")
        .update({ current_health_score: score, health_trend: trend, risk_level: risk })
        .eq("company_id", companyId);
    }

    // Log
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "health_scores",
      message: `Health scores v2: ${scores.length} companies scored`,
      details: {
        companies: scores.length,
        critical: scores.filter(s => (s.overall_score as number) < 30).length,
        declining: scores.filter(s => s.trend === "declining").length,
        improving: scores.filter(s => s.trend === "improving").length,
      },
    });

    return NextResponse.json({
      success: true,
      companies_scored: scores.length,
    });
  } catch (err) {
    console.error("[health-scores] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of arr) {
    const k = item[key] as number;
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
