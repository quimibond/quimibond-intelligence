import { NextRequest, NextResponse } from "next/server";

/**
 * Chat API route.
 *
 * TODO: Integrate Claude API for RAG-powered responses.
 *
 * To integrate Claude:
 * 1. Install `@anthropic-ai/sdk` and set ANTHROPIC_API_KEY in env.
 * 2. Build a system prompt with relevant context from Supabase
 *    (entities, facts, contacts, emails via pgvector similarity search).
 * 3. Send the conversation history + system prompt to Claude.
 * 4. Stream or return the response.
 *
 * Example:
 *   import Anthropic from "@anthropic-ai/sdk";
 *   const client = new Anthropic();
 *   const response = await client.messages.create({
 *     model: "claude-sonnet-4-20250514",
 *     max_tokens: 1024,
 *     system: systemPromptWithContext,
 *     messages: history.map(m => ({ role: m.role, content: m.content })),
 *   });
 */

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "El campo 'message' es requerido." },
        { status: 400 }
      );
    }

    // Mock response — replace with Claude API integration
    return NextResponse.json({
      response:
        "Esta funcionalidad requiere configurar la API de Claude. El mensaje recibido fue: " +
        message,
    });
  } catch {
    return NextResponse.json(
      { error: "Error procesando la solicitud." },
      { status: 500 }
    );
  }
}
