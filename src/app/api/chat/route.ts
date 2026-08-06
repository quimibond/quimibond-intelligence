/**
 * /api/chat — el analista agéntico (reescrito 2026-08-06).
 *
 * Antes: RAG plano (contexto ilike + embeddings concatenado al prompt).
 * Ahora: loop de tool-use con Claude — el modelo consulta SQL de lectura,
 * busca correos, lee hilos, saca fichas de cliente y costos de producto,
 * y cruza los resultados para responder. Ver src/lib/analyst/*.
 *
 * Contrato con la UI (sin cambios de fondo): POST {message, history} →
 * SSE con eventos {type: "tool"|"delta"|"done"|"error"}. El evento "tool"
 * es nuevo (la UI lo muestra como actividad; versiones viejas lo ignoran).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { logTokenUsage } from "@/lib/claude";
import { ANALYST_TOOLS, executeTool } from "@/lib/analyst/tools";
import { buildAnalystSystemPrompt } from "@/lib/analyst/system-prompt";

export const maxDuration = 300;

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOOL_ITERATIONS = 8;

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10_000),
  history: z.array(z.object({ role: z.string(), content: z.string() })).default([]),
});

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AgentMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

const TOOL_LABELS: Record<string, string> = {
  consultar_sql: "Consultando datos",
  buscar_correos: "Buscando en el correo",
  leer_hilo: "Leyendo conversación",
  ficha_cliente: "Armando ficha del cliente",
  costo_producto: "Consultando costos",
  pendientes_comunicacion: "Revisando pendientes",
};

async function callClaudeWithTools(
  apiKey: string,
  model: string,
  system: string,
  messages: AgentMessage[],
): Promise<ClaudeResponse> {
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      temperature: 0.3,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: ANALYST_TOOLS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as ClaudeResponse;
}

export async function POST(request: NextRequest) {
  const limited = rateLimitResponse(request, 20, 60_000, "chat");
  if (limited) return limited;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado" }, { status: 503 });
  }

  let body: z.infer<typeof ChatRequestSchema>;
  try {
    body = ChatRequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: "Request inválido", details: String(err) }, { status: 400 });
  }

  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const supabase = getServiceClient();
  const system = buildAnalystSystemPrompt();

  // Historial: solo user/assistant con texto, últimas 12 vueltas
  const messages: AgentMessage[] = body.history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  if (messages[messages.length - 1]?.content !== body.message) {
    messages.push({ role: "user", content: body.message });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        let finalText = "";

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const response = await callClaudeWithTools(apiKey, model, system, messages);
          if (response.usage) {
            logTokenUsage("chat", model, response.usage.input_tokens, response.usage.output_tokens);
          }

          const toolUses = response.content.filter(
            (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
          );

          if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
            finalText = response.content
              .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
              .map((b) => b.text)
              .join("");
            break;
          }

          // Ejecutar tools (en paralelo) y continuar el loop
          messages.push({ role: "assistant", content: response.content });
          const results = await Promise.all(
            toolUses.map(async (tu) => {
              emit({
                type: "tool",
                name: tu.name,
                label:
                  tu.name === "consultar_sql"
                    ? `Consultando: ${String((tu.input as Record<string, unknown>).proposito ?? "datos")}`
                    : (TOOL_LABELS[tu.name] ?? tu.name),
              });
              const output = await executeTool(supabase, tu.name, tu.input ?? {});
              return { type: "tool_result" as const, tool_use_id: tu.id, content: output };
            }),
          );
          messages.push({ role: "user", content: results });

          if (i === MAX_TOOL_ITERATIONS - 1) {
            // Presupuesto agotado: pedir cierre sin más tools
            messages.push({
              role: "user",
              content:
                "(Sistema: límite de consultas alcanzado. Responde ahora con lo que tienes, indicando qué faltó por verificar.)",
            });
            const closing = await callClaudeWithTools(apiKey, model, system, messages);
            finalText = closing.content
              .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
              .map((b) => b.text)
              .join("");
          }
        }

        if (!finalText) {
          finalText = "No pude generar una respuesta. Intenta reformular la pregunta.";
        }

        // Emitir en chunks para conservar la sensación de streaming en la UI
        for (let i = 0; i < finalText.length; i += 120) {
          emit({ type: "delta", text: finalText.slice(i, i + 120) });
        }
        emit({ type: "done" });
      } catch (err) {
        console.error("[chat] analyst error:", err);
        emit({ type: "error", error: "Error del analista. Intenta de nuevo." });
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
}
