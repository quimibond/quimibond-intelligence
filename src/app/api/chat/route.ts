import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaude, getVoyageEmbedding, logTokenUsage } from "@/lib/claude";
import { rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";

// Allow up to 120s for streaming responses
export const maxDuration = 120;

// Cache for static context (alerts, briefing, memory) — 5 min TTL
const STATIC_CTX_TTL = 5 * 60 * 1000;
let staticCtxCache: {
  alerts: string;
  briefing: string;
  chatMemory: string;
  expiry: number;
} | null = null;

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10_000),
  history: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).default([]),
});

async function getStaticContext(
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ alerts: string; briefing: string; chatMemory: string }> {
  if (staticCtxCache && Date.now() < staticCtxCache.expiry) {
    return staticCtxCache;
  }

  const [alertsRes, briefingRes, memoryRes] = await Promise.all([
    supabase
      .from("alerts")
      .select(
        "title, severity, alert_type, contact_name, description, state, created_at"
      )
      .eq("state", "new")
      .order("created_at", { ascending: false })
      .limit(15),

    supabase
      .from("briefings")
      .select("briefing_date, summary_text, total_emails, key_events")
      .eq("scope", "daily")
      .order("briefing_date", { ascending: false })
      .limit(1),

    supabase
      .from("chat_memory")
      .select("question, answer")
      .eq("thumbs_up", true)
      .order("times_retrieved", { ascending: false })
      .limit(3),
  ]);

  const alerts =
    alertsRes.data && alertsRes.data.length > 0
      ? alertsRes.data
          .map(
            (a) =>
              `- [${a.severity}] ${a.title} (${a.alert_type}) — ${a.contact_name ?? "general"}: ${a.description ?? ""}`
          )
          .join("\n")
      : "No hay alertas abiertas.";

  const briefing =
    briefingRes.data && briefingRes.data.length > 0
      ? `Fecha: ${briefingRes.data[0].briefing_date}\nEmails procesados: ${briefingRes.data[0].total_emails}\n${briefingRes.data[0].summary_text ?? "Sin resumen disponible."}`
      : "No hay briefing reciente disponible.";

  const chatMemory =
    memoryRes.data && memoryRes.data.length > 0
      ? memoryRes.data
          .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
          .join("\n\n")
      : "";

  staticCtxCache = { alerts, briefing, chatMemory, expiry: Date.now() + STATIC_CTX_TTL };
  return staticCtxCache;
}

async function gatherContext(
  query: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<ContextData> {
  const q = `%${query.toLowerCase()}%`;

  const [
    staticCtx,
    narrativesRes,
    paymentRes,
    reorderRes,
    insightsRes,
    factsRes,
    contactsRes,
    invoicesRes,
    anomaliesRes,
  ] = await Promise.all([
    getStaticContext(supabase),

    // Company narratives: the richest source (revenue + overdue + deliveries + complaints + risk_signal)
    supabase
      .from("company_narrative")
      .select("canonical_name, tier, total_revenue, revenue_90d, trend_pct, overdue_amount, max_days_overdue, late_deliveries, otd_rate, emails_30d, complaints, recent_complaints, total_purchases, risk_signal, salespeople, top_products, days_since_last_order")
      .or(`canonical_name.ilike.${q}`)
      .order("total_revenue", { ascending: false })
      .limit(5),

    // Payment predictions
    supabase
      .from("payment_predictions")
      .select("company_name, avg_days_to_pay, median_days_to_pay, payment_trend, total_pending, max_days_overdue, predicted_payment_date, payment_risk")
      .or(`company_name.ilike.${q}`)
      .limit(5),

    // Reorder predictions
    supabase
      .from("client_reorder_predictions")
      .select("company_name, avg_cycle_days, days_since_last, days_overdue_reorder, reorder_status, avg_order_value, salesperson_name, top_product_ref, total_revenue")
      .or(`company_name.ilike.${q}`)
      .limit(5),

    // Active Director insights (critical + high)
    supabase
      .from("agent_insights")
      .select("title, severity, category, assignee_name, created_at")
      .in("state", ["new", "seen"])
      .in("severity", ["critical", "high"])
      .gte("confidence", 0.80)
      .order("created_at", { ascending: false })
      .limit(10),

    // Facts from knowledge graph
    supabase
      .from("facts")
      .select("fact_text, fact_type, confidence")
      .ilike("fact_text", q)
      .gte("confidence", 0.85)
      .order("confidence", { ascending: false })
      .limit(10),

    // Contacts
    supabase
      .from("contacts")
      .select("name, email, company_id, role, risk_level, current_health_score")
      .or(`name.ilike.${q},email.ilike.${q}`)
      .limit(5),

    // Placeholder — invoices loaded separately below with company-aware logic
    Promise.resolve({ data: null }),

    // Accounting anomalies
    supabase
      .from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .in("severity", ["critical", "high"])
      .order("amount", { ascending: false })
      .limit(10),
  ]);

  const { alerts, briefing, chatMemory } = staticCtx;

  // Format company narratives (the core intelligence)
  const companies = (narrativesRes.data ?? []).length > 0
    ? (narrativesRes.data ?? []).map((c: Record<string, unknown>) => {
        let line = `**${c.canonical_name}** (${c.tier}) — Revenue: $${Number(c.total_revenue ?? 0).toLocaleString()}, 90d: $${Number(c.revenue_90d ?? 0).toLocaleString()} (${c.trend_pct ?? 0}%)`;
        if (Number(c.overdue_amount) > 0) line += ` | Vencido: $${Number(c.overdue_amount).toLocaleString()} (max ${c.max_days_overdue}d)`;
        if (Number(c.late_deliveries) > 0) line += ` | ${c.late_deliveries} entregas tarde`;
        if (Number(c.complaints) > 0) line += ` | ${c.complaints} quejas: "${String(c.recent_complaints ?? "").slice(0, 100)}"`;
        if (c.salespeople) line += ` | Vendedor: ${c.salespeople}`;
        if (c.top_products) line += ` | Productos: ${String(c.top_products).slice(0, 100)}`;
        if (c.risk_signal) line += ` | ALERTA: ${c.risk_signal}`;
        return line;
      }).join("\n")
    : "";

  // Payment predictions
  const payments = (paymentRes.data ?? []).length > 0
    ? (paymentRes.data ?? []).map((p: Record<string, unknown>) =>
        `- ${p.company_name}: paga en promedio ${p.avg_days_to_pay}d (mediana ${p.median_days_to_pay}d), tendencia ${p.payment_trend}, pendiente $${Number(p.total_pending ?? 0).toLocaleString()}, ${p.payment_risk}`
      ).join("\n")
    : "";

  // Reorder predictions
  const reorders = (reorderRes.data ?? []).length > 0
    ? (reorderRes.data ?? []).map((r: Record<string, unknown>) =>
        `- ${r.company_name}: compra cada ${r.avg_cycle_days}d, lleva ${r.days_since_last}d sin comprar (${r.reorder_status}), orden promedio $${Number(r.avg_order_value ?? 0).toLocaleString()}, vendedor: ${r.salesperson_name ?? "?"}, producto: ${r.top_product_ref ?? "?"}`
      ).join("\n")
    : "";

  const contacts = (contactsRes.data ?? []).length > 0
    ? (contactsRes.data ?? []).map((c: Record<string, unknown>) =>
        `- ${c.name} <${c.email}> | Riesgo: ${c.risk_level ?? "?"} | Health: ${c.current_health_score ?? "?"}`
      ).join("\n")
    : "";

  const facts = (factsRes.data ?? []).length > 0
    ? (factsRes.data ?? []).map((f: Record<string, unknown>) =>
        `- [${f.fact_type}] ${f.fact_text}`
      ).join("\n")
    : "";

  const activeInsights = (insightsRes.data ?? []).length > 0
    ? (insightsRes.data ?? []).map((i: Record<string, unknown>) =>
        `- [${i.severity}/${i.category}] ${i.title} → ${i.assignee_name ?? "sin asignar"}`
      ).join("\n")
    : "";

  // Semantic email search
  let semanticEmails = "";
  const embedding = await getVoyageEmbedding(query);
  if (embedding) {
    const { data: similarEmails } = await supabase.rpc("search_similar_emails", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: 0.6,
      match_count: 5,
    });
    if (similarEmails && similarEmails.length > 0) {
      semanticEmails = similarEmails
        .map((e: { subject: string; sender: string; snippet: string; email_date: string; similarity: number }) =>
          `- ${e.email_date?.split("T")[0] ?? "?"} | ${e.sender ?? "?"} | ${e.subject ?? "(sin asunto)"}\n  ${(e.snippet ?? "").slice(0, 150)}`
        ).join("\n");
    }
  }

  // Smart invoice loading: find companies mentioned in the query, fetch their invoices
  let invoiceData: Record<string, unknown>[] = [];
  {
    // Try to resolve company from query
    const { data: matchedCompanies } = await supabase
      .from("companies")
      .select("id, canonical_name")
      .or(`canonical_name.ilike.${q},name.ilike.${q}`)
      .limit(3);

    if (matchedCompanies?.length) {
      // Fetch invoices for the specific companies mentioned
      const companyIds = matchedCompanies.map(c => c.id);
      const { data: companyInvoices } = await supabase
        .from("odoo_invoices")
        .select("name, amount_total, amount_residual, amount_paid, currency, invoice_date, due_date, days_overdue, payment_state, payment_term, company_id")
        .eq("move_type", "out_invoice")
        .eq("state", "posted")
        .in("company_id", companyIds)
        .order("days_overdue", { ascending: false })
        .limit(20);
      invoiceData = (companyInvoices ?? []) as Record<string, unknown>[];

      // Add company name to each invoice
      const nameMap = new Map(matchedCompanies.map(c => [c.id, c.canonical_name]));
      for (const inv of invoiceData) {
        inv._company_name = nameMap.get(inv.company_id as number) ?? "";
      }
    }

    // If no company match or no invoices found, get general top overdue
    if (invoiceData.length === 0) {
      const { data: topOverdue } = await supabase
        .from("odoo_invoices")
        .select("name, amount_total, amount_residual, amount_paid, currency, invoice_date, due_date, days_overdue, payment_state, payment_term, company_id")
        .eq("move_type", "out_invoice")
        .in("payment_state", ["not_paid", "partial"])
        .eq("state", "posted")
        .gt("days_overdue", 0)
        .order("days_overdue", { ascending: false })
        .limit(15);
      invoiceData = (topOverdue ?? []) as Record<string, unknown>[];
    }
  }

  // Format overdue invoices
  const overdueInvoices = invoiceData.length > 0
    ? invoiceData.map((inv) => {
        const co = inv._company_name ? `[${inv._company_name}] ` : "";
        const status = Number(inv.days_overdue ?? 0) > 0 ? `vencida ${inv.days_overdue}d` : (inv.payment_state === "paid" ? "PAGADA" : "vigente");
        return `- ${co}${inv.name}: $${Number(inv.amount_residual ?? 0).toLocaleString()} ${inv.currency} ${status} (total $${Number(inv.amount_total ?? 0).toLocaleString()}, pagado $${Number(inv.amount_paid ?? 0).toLocaleString()}, vence ${inv.due_date ?? "?"}, terminos: ${inv.payment_term ?? "?"})`;
      }).join("\n")
    : "";

  // Format anomalies
  const anomalies = (anomaliesRes.data ?? []).length > 0
    ? (anomaliesRes.data ?? []).map((a: Record<string, unknown>) =>
        `- [${a.severity}/${a.anomaly_type}] ${a.description}`
      ).join("\n")
    : "";

  return { contacts, alerts, briefing, facts, chatMemory, semanticEmails, companies, activeInsights, payments, reorders, overdueInvoices, anomalies };
}

interface ContextData {
  contacts: string;
  alerts: string;
  briefing: string;
  facts: string;
  chatMemory: string;
  semanticEmails: string;
  companies: string;
  activeInsights: string;
  payments: string;
  reorders: string;
  overdueInvoices: string;
  anomalies: string;
}

function buildSystemPrompt(ctx: ContextData): string {
  let prompt = `Eres el asistente de inteligencia ejecutiva de Quimibond (fabricante mexicano de entretelas y no-tejidos).
Tienes acceso a datos en tiempo real de ventas, cobranza, entregas, proveedores, y comunicaciones.

Reglas:
- Responde en español (Mexico). Se directo y concreto.
- USA los datos del contexto — no inventes. Si no hay datos, dilo.
- Incluye montos en MXN, nombres de responsables, y referencias de producto cuando estén disponibles.
- Haz recomendaciones accionables: "llamar a X", "revisar factura Y", no genéricos.
- Para productos, usa la referencia interna (ej: WM4032OW152) no el nombre largo.
- Formato markdown para listas y énfasis.

## Datos en tiempo real`;

  if (ctx.companies) {
    prompt += `\n\n### Inteligencia de empresas (ventas, cartera, entregas, quejas, riesgo)\n${ctx.companies}`;
  }

  if (ctx.payments) {
    prompt += `\n\n### Prediccion de pagos (patron historico vs actual)\n${ctx.payments}`;
  }

  if (ctx.reorders) {
    prompt += `\n\n### Prediccion de reorden (ciclo de compra vs dias sin comprar)\n${ctx.reorders}`;
  }

  if (ctx.overdueInvoices) {
    prompt += `\n\n### Facturas vencidas (cartera por cobrar)\n${ctx.overdueInvoices}`;
  }

  if (ctx.anomalies) {
    prompt += `\n\n### Anomalias contables detectadas\n${ctx.anomalies}`;
  }

  if (ctx.activeInsights) {
    prompt += `\n\n### Insights activos de los 7 Directores IA\n${ctx.activeInsights}`;
  }

  if (ctx.contacts) {
    prompt += `\n\n### Contactos\n${ctx.contacts}`;
  }

  if (ctx.facts) {
    prompt += `\n\n### Hechos extraidos de emails\n${ctx.facts}`;
  }

  if (ctx.semanticEmails) {
    prompt += `\n\n### Emails relevantes\n${ctx.semanticEmails}`;
  }

  prompt += `\n\n### Briefing del dia\n${ctx.briefing}`;

  if (ctx.chatMemory) {
    prompt += `\n\n### Respuestas previas exitosas\n${ctx.chatMemory}`;
  }

  return prompt;
}

export async function POST(request: NextRequest) {
  // Rate limit: 20 requests per minute per client
  const limited = rateLimitResponse(request, 20, 60_000, "chat");
  if (limited) return limited;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        response:
          "Se requiere ANTHROPIC_API_KEY para usar el chat con IA. Configura la variable de entorno para activar esta funcionalidad.",
      });
    }

    const rawBody = await request.json();
    const parsed = ChatRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos invalidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { message, history } = parsed.data;

    const supabase = getServiceClient();

    // Gather RAG context from Supabase
    const context = await gatherContext(message, supabase);

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt(context);

    // Build conversation messages (limit to last 20 for context window)
    const conversationMessages = (history ?? [])
      .filter(
        (m) => m.role === "user" || m.role === "assistant"
      )
      .slice(-20)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Ensure last message is the current user message
    if (
      conversationMessages.length === 0 ||
      conversationMessages[conversationMessages.length - 1].content !== message
    ) {
      conversationMessages.push({ role: "user", content: message });
    }

    // Call Claude API with streaming (includes retry for 429/529)
    let claudeResponse: Response;
    try {
      claudeResponse = await callClaude(
        apiKey,
        {
          max_tokens: 2048,
          temperature: 0.5,
          stream: true,
          system: systemPrompt,
          messages: conversationMessages,
        },
        "chat"
      );
    } catch (err) {
      console.error("Claude API error:", err);
      return NextResponse.json(
        { error: "Error al llamar a Claude API.", detail: err instanceof Error ? err.message : "" },
        { status: 502 }
      );
    }

    if (!claudeResponse.ok) {
      const errorBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errorBody);
      return NextResponse.json(
        { error: `Error al llamar a Claude API (${claudeResponse.status}).`, detail: errorBody },
        { status: 502 }
      );
    }

    // Stream the response to the client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = claudeResponse.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: "No response body" })}\n\n`));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);
                if (event.type === "content_block_delta" && event.delta?.text) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`)
                  );
                } else if (event.type === "message_stop") {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
                  );
                } else if (event.type === "message_delta" && event.usage) {
                  console.log("[chat] Token usage:", JSON.stringify(event.usage));
                  logTokenUsage("chat", process.env.CLAUDE_MODEL || "claude-sonnet-4-6", 0, event.usage.output_tokens ?? 0);
                } else if (event.type === "message_start" && event.message?.usage) {
                  logTokenUsage("chat", process.env.CLAUDE_MODEL || "claude-sonnet-4-6", event.message.usage.input_tokens ?? 0, 0);
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: "Stream interrupted" })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Error procesando la solicitud de chat." },
      { status: 500 }
    );
  }
}
