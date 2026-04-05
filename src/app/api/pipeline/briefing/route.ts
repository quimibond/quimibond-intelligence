/**
 * CEO Briefing v2 — The final product of the intelligence system.
 *
 * Consolidates ALL intelligence sources into one daily briefing:
 * 1. Agent insights (new, high-priority from the last 24h)
 * 2. Odoo financials (cash position, overdue, recent payments)
 * 3. Email intelligence (facts, complaints, commitments)
 * 4. Overdue action items (promises not kept)
 * 5. Company health changes (who's growing, who's churning)
 * 6. Previous briefing context (continuity)
 *
 * Output: 5-7 actionable items, not a wall of text.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaude } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    // ── Gather ALL intelligence sources in parallel ─────────────────────
    const [
      // PRIMARY: Company narratives with risk signals (the core intelligence)
      narrativesRes,
      // Agent insights from last 24h
      insightsRes,
      // Insight HISTORY: what was acted on / dismissed recently (continuity)
      insightHistoryRes,
      // Recent payments (good news)
      recentPaymentsRes,
      // Email intelligence facts
      factsRes,
      // Pending actions
      actionsPendingRes,
      // Email volume
      emailVolumeRes,
      // Previous briefing
      previousRes,
    ] = await Promise.all([
      // 1. Company narratives — the connected intelligence view
      supabase
        .from("company_narrative")
        .select("canonical_name, tier, risk_level, total_revenue, revenue_90d, trend_pct, days_since_last_order, salespeople, top_products, overdue_amount, max_days_overdue, late_deliveries, otd_rate, emails_30d, complaints, recent_complaints, total_purchases, risk_signal")
        .not("risk_signal", "is", null)
        .order("total_revenue", { ascending: false })
        .limit(15),

      // 2. Agent insights from last 24h
      supabase
        .from("agent_insights")
        .select("title, severity, category, assignee_name, assignee_department")
        .in("state", ["new", "seen"])
        .gte("created_at", yesterday)
        .in("severity", ["critical", "high"])
        .gte("confidence", 0.8)
        .order("created_at", { ascending: false })
        .limit(10),

      // 3. Insight history: what was the CEO's feedback recently?
      supabase
        .from("agent_insights")
        .select("title, severity, category, state, assignee_name")
        .in("state", ["acted_on", "dismissed"])
        .gte("updated_at", weekAgo)
        .order("updated_at", { ascending: false })
        .limit(10),

      // 4. Recent payments
      supabase
        .from("odoo_payments")
        .select("company_id, amount, payment_date")
        .gte("payment_date", new Date(Date.now() - 3 * 24 * 3600_000).toISOString().split("T")[0])
        .order("amount", { ascending: false })
        .limit(5),

      // 5. Email facts
      supabase
        .from("facts")
        .select("fact_type, fact_text, confidence")
        .in("fact_type", ["commitment", "complaint", "request"])
        .gte("confidence", 0.9)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(10),

      // 6. Pending high-priority actions
      supabase
        .from("action_items")
        .select("description, priority, assignee_name, due_date")
        .eq("state", "pending")
        .in("priority", ["high"])
        .order("due_date", { ascending: true })
        .limit(5),

      // 7. Email volume
      supabase
        .from("emails")
        .select("sender_type", { count: "exact", head: true })
        .gte("email_date", yesterday),

      // 8. Previous briefing
      supabase
        .from("briefings")
        .select("summary_text")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1),
    ]);

    const narratives = narrativesRes.data ?? [];
    const insights = insightsRes.data ?? [];
    const insightHistory = insightHistoryRes.data ?? [];
    const payments = recentPaymentsRes.data ?? [];
    const facts = factsRes.data ?? [];
    const pendingActions = actionsPendingRes.data ?? [];
    const previousSummary = previousRes.data?.[0]?.summary_text ?? "";

    // ── Build the consolidated data package ─────────────────────────────
    const dataPackage = buildConsolidatedPackage({
      today,
      narratives,
      insights,
      insightHistory,
      payments,
      facts,
      pendingActions,
      emailCount: emailVolumeRes.count ?? 0,
      previousSummary,
    });

    // ── Generate briefing with Claude ───────────────────────────────────
    const system = `Eres el analista de inteligencia ejecutiva de Quimibond, fabricante mexicano de entretelas y no-tejidos.

Genera un briefing diario en HTML limpio (sin <html><body>, solo contenido interno).
Usa <h2>, <h3>, <ul>, <li>, <strong>, <em>, <span style="color:red"> para urgente.

ESTRUCTURA OBLIGATORIA:
1. <h2>Resumen del dia</h2> — 3 lineas max. Que paso, que importa, que necesita accion.
2. <h2>Decisiones que necesitas hoy</h2> — Max 3 items. Solo cosas que requieren decision del CEO/directivo HOY. Incluir nombre de responsable y monto si aplica.
3. <h2>Alertas criticas</h2> — Riesgos que no se pueden ignorar. Clientes cayendo, cartera peligrosa, promesas incumplidas.
4. <h2>Seguimientos</h2> — Acciones vencidas que alguien prometio y no hizo. Nombre + que debian hacer + cuando vencia.
5. <h2>Buenas noticias</h2> — Pagos recibidos, clientes creciendo, deals cerrados. Maximo 3.

REGLAS:
- MAXIMO 7 items en total entre todas las secciones. No mas.
- Cada item debe nombrar UNA persona o empresa especifica
- Incluir montos en MXN cuando sea posible
- Si no hay nada critico, di "Sin alertas criticas hoy" — no inventes
- NO repitas informacion del briefing anterior
- Sé brutalmente conciso. El CEO lee esto en 2 minutos.`;

    const response = await callClaude(apiKey, {
      system,
      messages: [{ role: "user", content: dataPackage }],
      max_tokens: 3000,
    }, "briefing");

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const claudeJson = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const briefingHtml = claudeJson.content
      .filter(c => c.type === "text")
      .map(c => c.text ?? "")
      .join("");

    const summaryText = briefingHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    // Extract topics from narratives
    const topicSet = new Set<string>();
    const risks = [];
    for (const n of narratives as Record<string, unknown>[]) {
      const signal = String(n.risk_signal ?? "");
      if (signal.includes("cartera")) topicSet.add("cartera_vencida");
      if (signal.includes("churn")) topicSet.add("churn");
      if (signal.includes("entrega")) topicSet.add("entregas_atrasadas");
      if (signal.includes("queja")) topicSet.add("quejas");
      risks.push({ company: n.canonical_name, signal });
    }
    if (insights.length) topicSet.add("agent_insights");

    // ── Save briefing ──────────────────────────────────────────────────
    const { error: insertError } = await supabase.from("briefings").insert({
      briefing_date: today,
      scope: "daily",
      account: "all",
      summary_html: briefingHtml,
      summary_text: summaryText,
      total_emails: emailCount(emailVolumeRes),
      topics_identified: [...topicSet].map(t => ({ topic: t, status: "new" })),
      risks_detected: risks,
      overall_sentiment: risks.length > 3 ? "negative" : risks.length === 0 ? "positive" : "neutral",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        await supabase.from("briefings")
          .update({
            summary_html: briefingHtml,
            summary_text: summaryText,
            total_emails: emailCount(emailVolumeRes),
            topics_identified: [...topicSet].map(t => ({ topic: t, status: "new" })),
            risks_detected: risks,
            overall_sentiment: risks.length > 3 ? "negative" : risks.length === 0 ? "positive" : "neutral",
          })
          .eq("briefing_date", today)
          .eq("scope", "daily")
          .eq("account", "all");
      } else {
        console.error("[briefing] Insert error:", insertError);
      }
    }

    return NextResponse.json({
      success: true,
      briefing_date: today,
      sources: {
        companies_at_risk: narratives.length,
        insights: insights.length,
        insight_history: insightHistory.length,
        recent_payments: payments.length,
        email_facts: facts.length,
        pending_actions: pendingActions.length,
      },
    });
  } catch (err) {
    console.error("[briefing] Error:", err);
    return NextResponse.json(
      { error: "Error generando briefing.", detail: String(err) },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emailCount(res: any): number {
  return typeof res.count === "number" ? res.count : 0;
}

// ── Build consolidated data package ──────────────────────────────────────

interface BriefingData {
  today: string;
  narratives: Record<string, unknown>[];
  insights: Record<string, unknown>[];
  insightHistory: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  pendingActions: Record<string, unknown>[];
  emailCount: number;
  previousSummary: string;
}

function buildConsolidatedPackage(data: BriefingData): string {
  const lines: string[] = [];

  lines.push(`=== BRIEFING EJECUTIVO QUIMIBOND — ${data.today} ===`);
  lines.push(`${data.narratives.length} empresas con señales de alerta, ${data.insights.length} insights nuevos, ${data.emailCount} emails procesados\n`);

  // Previous context (don't repeat)
  if (data.previousSummary) {
    lines.push(`--- BRIEFING ANTERIOR (NO repetir esta info) ---`);
    lines.push(data.previousSummary.slice(0, 300));
    lines.push("");
  }

  // ── 1. COMPANY NARRATIVES: the core of the briefing ──────────────────
  // Each narrative is a connected story, not isolated data points
  if (data.narratives.length) {
    lines.push(`--- EMPRESAS QUE REQUIEREN ATENCION ---`);
    for (const n of data.narratives) {
      lines.push(`\n  ${String(n.canonical_name).toUpperCase()} (${n.tier}) — ${n.risk_signal}`);
      lines.push(`    Revenue: $${Number(n.total_revenue ?? 0).toLocaleString()} total, $${Number(n.revenue_90d ?? 0).toLocaleString()} ultimos 90d (${n.trend_pct ?? 0}%)`);
      if (Number(n.overdue_amount) > 0) lines.push(`    Cartera vencida: $${Number(n.overdue_amount).toLocaleString()} (max ${n.max_days_overdue} dias)`);
      if (Number(n.late_deliveries) > 0) lines.push(`    Entregas atrasadas: ${n.late_deliveries} | OTD: ${n.otd_rate ?? '?'}%`);
      if (Number(n.complaints) > 0) lines.push(`    Quejas en emails: ${n.complaints} — "${String(n.recent_complaints ?? '').slice(0, 150)}"`);
      if (Number(n.emails_30d) === 0) lines.push(`    SIN comunicacion en 30 dias`);
      if (n.salespeople) lines.push(`    Responsable: ${n.salespeople}`);
      if (n.top_products) lines.push(`    Productos: ${String(n.top_products).slice(0, 150)}`);
    }
    lines.push("");
  }

  // ── 2. NEW INSIGHTS from agents (brief, not detailed) ─────────────────
  if (data.insights.length) {
    lines.push(`--- INSIGHTS NUEVOS DE AGENTES (ultimas 24h) ---`);
    for (const i of data.insights) {
      lines.push(`  [${String(i.severity).toUpperCase()}/${i.category}] ${i.title}`);
      if (i.assignee_name) lines.push(`    → ${i.assignee_name} (${i.assignee_department})`);
    }
    lines.push("");
  }

  // ── 3. INSIGHT HISTORY: what did the CEO do? (learning signal) ─────────
  if (data.insightHistory.length) {
    const acted = data.insightHistory.filter(i => i.state === "acted_on");
    const dismissed = data.insightHistory.filter(i => i.state === "dismissed");
    if (acted.length || dismissed.length) {
      lines.push(`--- FEEDBACK DEL CEO (ultima semana) ---`);
      if (acted.length) lines.push(`  Actuó en: ${acted.map(i => String(i.title).slice(0, 60)).join(" | ")}`);
      if (dismissed.length) lines.push(`  Descartó: ${dismissed.map(i => String(i.title).slice(0, 60)).join(" | ")}`);
      lines.push("");
    }
  }

  // ── 4. PAYMENTS received (good news) ───────────────────────────────────
  if (data.payments.length) {
    lines.push(`--- PAGOS RECIBIDOS (ultimos 3 dias) ---`);
    for (const p of data.payments) {
      lines.push(`  $${Number(p.amount).toLocaleString()} MXN — ${p.payment_date}`);
    }
    lines.push("");
  }

  // ── 5. PENDING ACTIONS (high priority) ──────────────────────────────────
  if (data.pendingActions.length) {
    lines.push(`--- ACCIONES PENDIENTES (alta prioridad) ---`);
    for (const a of data.pendingActions) {
      lines.push(`  ${a.due_date}: ${String(a.description).slice(0, 120)} → ${a.assignee_name || "sin asignar"}`);
    }
    lines.push("");
  }

  // ── 6. EMAIL INTELLIGENCE (high-signal facts) ──────────────────────────
  if (data.facts.length) {
    lines.push(`--- SEÑALES DETECTADAS EN EMAILS ---`);
    for (const f of data.facts) {
      lines.push(`  [${f.fact_type}] ${f.fact_text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
