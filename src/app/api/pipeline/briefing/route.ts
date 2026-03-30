import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaude } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

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
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    // Gather data from what we actually have
    const [emailsRes, factsRes, actionsRes, metricsRes, previousRes] = await Promise.all([
      supabase
        .from("emails")
        .select("account, sender, subject, snippet, email_date, sender_type")
        .gte("email_date", cutoff)
        .order("email_date", { ascending: false })
        .limit(200),

      supabase
        .from("facts")
        .select("fact_text, fact_type, confidence, created_at")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("action_items")
        .select("description, priority, state, contact_name, due_date")
        .eq("state", "pending")
        .order("due_date", { ascending: true })
        .limit(20),

      supabase
        .from("communication_metrics")
        .select("*")
        .order("metric_date", { ascending: false })
        .limit(10),

      supabase
        .from("briefings")
        .select("summary_text")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1),
    ]);

    const emails = emailsRes.data ?? [];
    const facts = factsRes.data ?? [];
    const actions = actionsRes.data ?? [];
    const metrics = metricsRes.data ?? [];
    const previousSummary = previousRes.data?.[0]?.summary_text ?? "";

    if (!emails.length && !facts.length) {
      return NextResponse.json({
        success: true,
        message: "Sin datos para generar briefing",
        debug: {
          emails_query_error: emailsRes.error?.message,
          facts_query_error: factsRes.error?.message,
          cutoff,
        },
      });
    }

    // Build data package
    const dataPackage = buildDataPackage(today, emails, facts, actions, metrics, previousSummary);

    // Call Claude
    const system = (
      "Eres el analista de inteligencia de Quimibond (textiles no tejidos, México). "
      + "Genera un briefing ejecutivo en HTML limpio (sin <html><body>, solo contenido). "
      + "Usa <h2>, <h3>, <ul>, <li>, <strong>, <em>. "
      + "Estructura: 1) Resumen ejecutivo (3 líneas), 2) Decisiones urgentes, "
      + "3) Seguimientos pendientes, 4) Oportunidades detectadas, 5) FYI. "
      + "Sé directo y accionable. Incluye nombres de contactos y empresas."
    );

    const response = await callClaude(apiKey, {
      system,
      messages: [{ role: "user", content: dataPackage }],
      max_tokens: 4000,
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

    // Extract summary text
    const summaryText = briefingHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    // Count topics from facts
    const topicSet = new Set(facts.map(f => (f as Record<string, unknown>).fact_type).filter(Boolean));

    // Save briefing (insert, not upsert — unique key includes account)
    const { error: insertError } = await supabase.from("briefings").insert({
      briefing_date: today,
      scope: "daily",
      account: "all",
      summary_html: briefingHtml,
      summary_text: summaryText,
      total_emails: emails.length,
      topics_identified: [...topicSet].map(t => ({ topic: t, status: "new" })),
      risks_detected: [],
    });

    if (insertError) {
      // If duplicate, try update instead
      if (insertError.code === "23505") {
        await supabase.from("briefings")
          .update({
            summary_html: briefingHtml,
            summary_text: summaryText,
            total_emails: emails.length,
            topics_identified: [...topicSet].map(t => ({ topic: t, status: "new" })),
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
      emails_analyzed: emails.length,
      facts_used: facts.length,
      actions_pending: actions.length,
    });
  } catch (err) {
    console.error("[briefing] Error:", err);
    return NextResponse.json(
      { error: "Error generando briefing.", detail: String(err) },
      { status: 500 }
    );
  }
}

function buildDataPackage(
  today: string,
  emails: Record<string, unknown>[],
  facts: Record<string, unknown>[],
  actions: Record<string, unknown>[],
  metrics: Record<string, unknown>[],
  previousSummary: string
): string {
  const lines: string[] = [];

  lines.push(`=== BRIEFING EJECUTIVO ${today} ===\n`);
  lines.push(`Emails recientes: ${emails.length}`);
  lines.push(`Hechos extraidos: ${facts.length}`);
  lines.push(`Acciones pendientes: ${actions.length}\n`);

  if (previousSummary) {
    lines.push(`--- CONTEXTO PREVIO ---`);
    lines.push(previousSummary.slice(0, 800));
    lines.push("");
  }

  // Email summary by account
  const byAccount = new Map<string, number>();
  const externalSenders = new Set<string>();
  for (const e of emails) {
    const acct = String(e.account ?? "unknown");
    byAccount.set(acct, (byAccount.get(acct) ?? 0) + 1);
    if (e.sender_type === "external") {
      externalSenders.add(String(e.sender ?? ""));
    }
  }
  lines.push(`--- VOLUMEN POR CUENTA ---`);
  for (const [acct, count] of [...byAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    lines.push(`  ${acct}: ${count} emails`);
  }
  lines.push(`Remitentes externos unicos: ${externalSenders.size}\n`);

  // Recent email subjects (context)
  lines.push(`--- EMAILS RECIENTES (asuntos) ---`);
  for (const e of emails.slice(0, 30)) {
    const date = String(e.email_date ?? "").split("T")[0];
    const type = e.sender_type === "external" ? "[EXT]" : "[INT]";
    lines.push(`  ${date} ${type} ${e.sender}: ${e.subject}`);
  }
  lines.push("");

  // Facts
  if (facts.length > 0) {
    lines.push(`--- HECHOS EXTRAIDOS POR IA ---`);
    for (const f of facts) {
      const conf = Number(f.confidence ?? 0);
      lines.push(`  [${f.fact_type}] (${Math.round(conf * 100)}%) ${f.fact_text}`);
    }
    lines.push("");
  }

  // Pending actions
  if (actions.length > 0) {
    lines.push(`--- ACCIONES PENDIENTES ---`);
    for (const a of actions) {
      const due = a.due_date ? ` (vence: ${a.due_date})` : "";
      lines.push(`  [${a.priority}] ${a.description} — ${a.contact_name ?? "sin contacto"}${due}`);
    }
    lines.push("");
  }

  // Metrics
  if (metrics.length > 0) {
    lines.push(`--- METRICAS DE COMUNICACION ---`);
    for (const m of metrics.slice(0, 5)) {
      lines.push(`  ${JSON.stringify(m)}`);
    }
  }

  return lines.join("\n");
}
