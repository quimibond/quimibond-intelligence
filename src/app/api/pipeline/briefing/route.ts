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
      insightsRes,
      financialsRes,
      overdueInvoicesRes,
      recentPaymentsRes,
      factsRes,
      actionsOverdueRes,
      actionsPendingRes,
      churningRes,
      growingRes,
      lateDeliveriesRes,
      emailVolumeRes,
      employeeRes,
      previousRes,
    ] = await Promise.all([
      // 1. Agent insights from last 24h (new, high-value)
      supabase
        .from("agent_insights")
        .select("title, description, severity, insight_type, category, confidence, company_id, assignee_name, assignee_department")
        .in("state", ["new", "seen"])
        .gte("created_at", yesterday)
        .in("severity", ["critical", "high", "medium"])
        .gte("confidence", 0.7)
        .order("severity", { ascending: true })
        .limit(20),

      // 2. Financial snapshot
      supabase
        .from("odoo_invoices")
        .select("company_id, amount_total, amount_residual, payment_state, days_overdue")
        .eq("move_type", "out_invoice")
        .gt("amount_residual", 0)
        .order("amount_residual", { ascending: false })
        .limit(5),

      // 3. Most overdue invoices with company context
      supabase
        .from("company_profile")
        .select("name, overdue_amount, overdue_count, max_days_overdue, total_revenue, tier, sales_handler_name")
        .gt("overdue_amount", 50000)
        .order("overdue_amount", { ascending: false })
        .limit(10),

      // 4. Recent payments (good news)
      supabase
        .from("odoo_payments")
        .select("company_id, amount, payment_date")
        .gte("payment_date", new Date(Date.now() - 3 * 24 * 3600_000).toISOString().split("T")[0])
        .order("amount", { ascending: false })
        .limit(5),

      // 5. Email intelligence: recent high-value facts
      supabase
        .from("facts")
        .select("fact_type, fact_text, confidence")
        .in("fact_type", ["commitment", "complaint", "request", "price", "change"])
        .gte("confidence", 0.9)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(15),

      // 6. Overdue high-priority action items
      supabase
        .from("action_items")
        .select("description, priority, assignee_name, contact_name, due_date")
        .eq("state", "pending")
        .in("priority", ["high", "critical"])
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(10),

      // 7. Upcoming action items (next 3 days)
      supabase
        .from("action_items")
        .select("description, priority, assignee_name, due_date")
        .eq("state", "pending")
        .gte("due_date", today)
        .lte("due_date", new Date(Date.now() + 3 * 24 * 3600_000).toISOString().split("T")[0])
        .in("priority", ["high", "critical"])
        .order("due_date", { ascending: true })
        .limit(10),

      // 8. Churning clients (revenue dropping >30%)
      supabase
        .from("company_profile")
        .select("name, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, tier")
        .in("tier", ["strategic", "important"])
        .lt("trend_pct", -30)
        .order("total_revenue", { ascending: false })
        .limit(5),

      // 9. Growing clients
      supabase
        .from("company_profile")
        .select("name, revenue_90d, trend_pct, tier")
        .in("tier", ["strategic", "important", "regular"])
        .gt("trend_pct", 20)
        .order("trend_pct", { ascending: false })
        .limit(5),

      // 10. Late deliveries
      supabase
        .from("odoo_deliveries")
        .select("company_id, name, scheduled_date, is_late")
        .eq("is_late", true)
        .not("state", "in", '("done","cancel")')
        .limit(10),

      // 11. Email volume (yesterday)
      supabase
        .from("emails")
        .select("sender_type", { count: "exact", head: true })
        .gte("email_date", yesterday),

      // 12. Employee performance (bottom performers)
      supabase
        .from("employee_metrics")
        .select("name, department, actions_overdue, activities_overdue, execution_score, overall_score")
        .eq("period_type", "weekly")
        .lt("execution_score", 30)
        .order("execution_score", { ascending: true })
        .limit(5),

      // 13. Previous briefing for continuity
      supabase
        .from("briefings")
        .select("summary_text")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1),
    ]);

    const insights = insightsRes.data ?? [];
    const overdue = overdueInvoicesRes.data ?? [];
    const payments = recentPaymentsRes.data ?? [];
    const facts = factsRes.data ?? [];
    const overdueActions = actionsOverdueRes.data ?? [];
    const upcomingActions = actionsPendingRes.data ?? [];
    const churning = churningRes.data ?? [];
    const growing = growingRes.data ?? [];
    const lateDeliveries = lateDeliveriesRes.data ?? [];
    const underperformers = employeeRes.data ?? [];
    const previousSummary = previousRes.data?.[0]?.summary_text ?? "";

    // ── Build the consolidated data package ─────────────────────────────
    const dataPackage = buildConsolidatedPackage({
      today,
      insights,
      financials: financialsRes.data ?? [],
      overdue,
      payments,
      facts,
      overdueActions,
      upcomingActions,
      churning,
      underperformers,
      growing,
      lateDeliveries,
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

    // Extract topics
    const topicSet = new Set<string>();
    if (insights.length) topicSet.add("agent_insights");
    if (overdue.length) topicSet.add("cartera_vencida");
    if (churning.length) topicSet.add("clientes_cayendo");
    if (lateDeliveries.length) topicSet.add("entregas_atrasadas");
    if (overdueActions.length) topicSet.add("acciones_vencidas");
    for (const f of facts) {
      if ((f as Record<string, unknown>).fact_type) topicSet.add(String((f as Record<string, unknown>).fact_type));
    }

    // Detect risks
    const risks = [];
    if (churning.length) risks.push({ type: "churn", count: churning.length, companies: churning.map((c: Record<string, unknown>) => c.name) });
    if (overdue.length) risks.push({ type: "overdue", count: overdue.length });
    if (overdueActions.length) risks.push({ type: "broken_promises", count: overdueActions.length });

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
      overall_sentiment: churning.length > 2 ? "negative" : growing.length > churning.length ? "positive" : "neutral",
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
            overall_sentiment: churning.length > 2 ? "negative" : growing.length > churning.length ? "positive" : "neutral",
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
        insights: insights.length,
        overdue_invoices: overdue.length,
        recent_payments: payments.length,
        email_facts: facts.length,
        overdue_actions: overdueActions.length,
        churning_clients: churning.length,
        growing_clients: growing.length,
        late_deliveries: lateDeliveries.length,
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
  insights: Record<string, unknown>[];
  financials: Record<string, unknown>[];
  overdue: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  overdueActions: Record<string, unknown>[];
  upcomingActions: Record<string, unknown>[];
  churning: Record<string, unknown>[];
  underperformers: Record<string, unknown>[];
  growing: Record<string, unknown>[];
  lateDeliveries: Record<string, unknown>[];
  emailCount: number;
  previousSummary: string;
}

function buildConsolidatedPackage(data: BriefingData): string {
  const lines: string[] = [];

  lines.push(`=== BRIEFING EJECUTIVO QUIMIBOND — ${data.today} ===`);
  lines.push(`Fuentes: ${data.insights.length} insights de agentes, ${data.facts.length} hechos de email, ${data.overdueActions.length} acciones vencidas, ${data.emailCount} emails procesados\n`);

  // Previous context
  if (data.previousSummary) {
    lines.push(`--- BRIEFING ANTERIOR (no repetir) ---`);
    lines.push(data.previousSummary.slice(0, 400));
    lines.push("");
  }

  // 1. Agent insights (the most curated intelligence)
  if (data.insights.length) {
    lines.push(`--- INSIGHTS DE AGENTES (ultimas 24h, confianza >70%) ---`);
    // Group by severity
    const critical = data.insights.filter(i => i.severity === "critical");
    const high = data.insights.filter(i => i.severity === "high");
    const medium = data.insights.filter(i => i.severity === "medium");

    for (const group of [
      { label: "CRITICO", items: critical },
      { label: "ALTO", items: high },
      { label: "MEDIO", items: medium },
    ]) {
      for (const i of group.items) {
        lines.push(`  [${group.label}] ${i.title}`);
        lines.push(`    ${String(i.description).slice(0, 200)}`);
        if (i.assignee_name) lines.push(`    → Asignado a: ${i.assignee_name} (${i.assignee_department})`);
      }
    }
    lines.push("");
  }

  // 2. Financial position
  if (data.overdue.length) {
    lines.push(`--- CARTERA VENCIDA (empresas con >$50K MXN) ---`);
    for (const c of data.overdue) {
      lines.push(`  ${c.name}: $${Number(c.overdue_amount).toLocaleString()} vencido (${c.overdue_count} facturas, max ${c.max_days_overdue} dias) — tier: ${c.tier}`);
    }
    lines.push("");
  }

  // 3. Recent payments (good news)
  if (data.payments.length) {
    lines.push(`--- PAGOS RECIBIDOS (ultimos 3 dias) ---`);
    for (const p of data.payments) {
      lines.push(`  $${Number(p.amount).toLocaleString()} MXN — ${p.payment_date}`);
    }
    lines.push("");
  }

  // 4. Overdue action items (broken promises)
  if (data.overdueActions.length) {
    lines.push(`--- ACCIONES VENCIDAS (promesas incumplidas) ---`);
    for (const a of data.overdueActions) {
      lines.push(`  VENCIDA ${a.due_date}: ${String(a.description).slice(0, 120)}`);
      lines.push(`    Responsable: ${a.assignee_name || "sin asignar"} | Contacto: ${a.contact_name || "n/a"}`);
    }
    lines.push("");
  }

  // 5. Upcoming critical actions (next 3 days)
  if (data.upcomingActions.length) {
    lines.push(`--- ACCIONES PROXIMAS (3 dias, alta prioridad) ---`);
    for (const a of data.upcomingActions) {
      lines.push(`  ${a.due_date}: ${String(a.description).slice(0, 120)} → ${a.assignee_name || "sin asignar"}`);
    }
    lines.push("");
  }

  // 6. Client health changes
  if (data.churning.length) {
    lines.push(`--- CLIENTES CAYENDO (revenue -30%+ vs trimestre anterior) ---`);
    for (const c of data.churning) {
      lines.push(`  ${c.name}: ${c.trend_pct}% (${c.tier}) — de $${Number(c.revenue_prior_90d).toLocaleString()} a $${Number(c.revenue_90d).toLocaleString()}`);
    }
    lines.push("");
  }

  if (data.growing.length) {
    lines.push(`--- CLIENTES CRECIENDO (+20%+) ---`);
    for (const c of data.growing) {
      lines.push(`  ${c.name}: +${c.trend_pct}% (${c.tier})`);
    }
    lines.push("");
  }

  // 7. Late deliveries
  if (data.lateDeliveries.length) {
    lines.push(`--- ENTREGAS ATRASADAS ---`);
    for (const d of data.lateDeliveries) {
      lines.push(`  ${d.name}: programada ${d.scheduled_date}`);
    }
    lines.push("");
  }

  // 8. Team performance alerts
  if (data.underperformers.length) {
    lines.push(`--- EQUIPO: PERSONAS CON EJECUCION BAJA (<30%) ---`);
    for (const e of data.underperformers) {
      lines.push(`  ${e.name} (${e.department}): score ${e.execution_score}% — ${e.actions_overdue} acciones vencidas, ${e.activities_overdue} actividades Odoo vencidas`);
    }
    lines.push("");
  }

  // 9. Email intelligence (high-signal facts)
  if (data.facts.length) {
    lines.push(`--- INTELIGENCIA DE EMAIL (hechos clave) ---`);
    for (const f of data.facts) {
      lines.push(`  [${f.fact_type}] ${f.fact_text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
