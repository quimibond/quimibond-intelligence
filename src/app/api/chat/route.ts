import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

// Allow up to 120s for streaming responses
export const maxDuration = 120;

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

interface ContextData {
  contacts: string;
  alerts: string;
  briefing: string;
  facts: string;
  chatMemory: string;
}

async function gatherContext(
  query: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<ContextData> {
  const q = `%${query.toLowerCase()}%`;

  const [contactsRes, alertsRes, briefingRes, factsRes, memoryRes] =
    await Promise.all([
      // Relevant contacts
      supabase
        .from("contacts")
        .select(
          "name, email, company, role, risk_level, sentiment_score, relationship_score, last_activity"
        )
        .or(`name.ilike.${q},email.ilike.${q},company.ilike.${q}`)
        .order("last_activity", { ascending: false, nullsFirst: false })
        .limit(10),

      // Open alerts
      supabase
        .from("alerts")
        .select(
          "title, severity, alert_type, contact_name, description, state, created_at"
        )
        .eq("state", "new")
        .order("created_at", { ascending: false })
        .limit(15),

      // Latest briefing
      supabase
        .from("daily_summaries")
        .select("summary_date, summary_text, total_emails, key_events")
        .order("summary_date", { ascending: false })
        .limit(1),

      // Relevant facts
      supabase
        .from("facts")
        .select("fact_text, fact_type, confidence, created_at")
        .ilike("fact_text", q)
        .order("confidence", { ascending: false })
        .limit(15),

      // Chat memory (successful Q&A pairs for few-shot)
      // rating is integer in real schema; thumbs_up=true means positive
      supabase
        .from("chat_memory")
        .select("question, answer")
        .eq("thumbs_up", true)
        .order("times_retrieved", { ascending: false })
        .limit(3),
    ]);

  const contacts =
    contactsRes.data && contactsRes.data.length > 0
      ? contactsRes.data
          .map(
            (c) =>
              `- ${c.name} <${c.email}> | ${c.company ?? "?"} | Rol: ${c.role ?? "?"} | Riesgo: ${c.risk_level ?? "?"} | Sentimiento: ${c.sentiment_score ?? "?"} | Relacion: ${c.relationship_score ?? "?"}`
          )
          .join("\n")
      : "No se encontraron contactos relevantes.";

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
      ? `Fecha: ${briefingRes.data[0].summary_date}\nEmails procesados: ${briefingRes.data[0].total_emails}\n${briefingRes.data[0].summary_text ?? "Sin resumen disponible."}`
      : "No hay briefing reciente disponible.";

  const facts =
    factsRes.data && factsRes.data.length > 0
      ? factsRes.data
          .map(
            (f) =>
              `- [${f.fact_type ?? "general"}] ${f.fact_text} (confianza: ${Math.round(f.confidence * 100)}%)`
          )
          .join("\n")
      : "";

  const chatMemory =
    memoryRes.data && memoryRes.data.length > 0
      ? memoryRes.data
          .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
          .join("\n\n")
      : "";

  return { contacts, alerts, briefing, facts, chatMemory };
}

function buildSystemPrompt(ctx: ContextData): string {
  let prompt = `Eres el asistente de inteligencia comercial de Quimibond, empresa textil mexicana.
Tu rol es ayudar al equipo directivo a entender la situacion comercial: contactos, alertas, riesgos, oportunidades y tendencias.

Reglas:
- Responde siempre en espanol (Mexico).
- Se conciso pero completo. Usa datos concretos del contexto cuando esten disponibles.
- Si no tienes informacion suficiente, dilo honestamente.
- Cuando menciones contactos, incluye su empresa y datos relevantes.
- Puedes hacer recomendaciones accionables basadas en los datos.
- Usa formato markdown para listas y enfasis.

## Contexto actual

### Alertas abiertas
${ctx.alerts}

### Ultimo briefing
${ctx.briefing}

### Contactos relevantes
${ctx.contacts}`;

  if (ctx.facts) {
    prompt += `\n\n### Hechos del knowledge graph\n${ctx.facts}`;
  }

  if (ctx.chatMemory) {
    prompt += `\n\n### Ejemplos de respuestas exitosas previas\n${ctx.chatMemory}`;
  }

  return prompt;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        response:
          "Se requiere ANTHROPIC_API_KEY para usar el chat con IA. Configura la variable de entorno para activar esta funcionalidad.",
      });
    }

    const body: ChatRequest = await request.json();
    const { message, history } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "El campo 'message' es requerido." },
        { status: 400 }
      );
    }

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

    // Call Claude API with streaming
    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
          max_tokens: 2048,
          stream: true,
          system: systemPrompt,
          messages: conversationMessages,
        }),
      }
    );

    if (!claudeResponse.ok) {
      const errorBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errorBody);
      return NextResponse.json(
        {
          error: `Error al llamar a Claude API (${claudeResponse.status}).`,
          detail: errorBody,
        },
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
