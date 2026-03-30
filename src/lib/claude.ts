/**
 * Shared Claude API helper with retry logic, token logging, and usage tracking.
 */
import { createClient } from "@supabase/supabase-js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

/** Fire-and-forget token usage logging to Supabase */
export function logTokenUsage(endpoint: string, model: string, input_tokens: number, output_tokens: number) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? (process.env.POSTGRES_HOST ? `https://${process.env.POSTGRES_HOST.replace('db.', '')}` : '');
    const key = process.env.SUPABASE_SERVICE_KEY
      ?? process.env.SUPABASE_SECRET_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const supabase = createClient(url, key);
    supabase.from("token_usage").insert({ endpoint, model, input_tokens, output_tokens }).then();
  } catch {
    // Never block on usage logging
  }
}
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = [429, 529, 502, 503];

interface ClaudeRequestOptions {
  model?: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  stream?: boolean;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

export async function callClaude(
  apiKey: string,
  options: ClaudeRequestOptions,
  label: string = "claude"
): Promise<Response> {
  const model = options.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const body = {
    model,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    stream: options.stream ?? false,
    system: options.system,
    messages: options.messages,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
      console.log(`[${label}] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (response.ok || !RETRYABLE_STATUSES.includes(response.status)) {
        return response;
      }

      // Retryable error
      const errorText = await response.text();
      lastError = new Error(`Claude API ${response.status}: ${errorText.slice(0, 200)}`);
      console.warn(`[${label}] ${lastError.message}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[${label}] Network error: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("Claude API call failed after retries");
}

/**
 * Call Claude and parse the JSON response, with token logging.
 */
export async function callClaudeJSON<T>(
  apiKey: string,
  options: Omit<ClaudeRequestOptions, "stream">,
  label: string = "claude"
): Promise<{ result: T; usage?: { input_tokens: number; output_tokens: number } }> {
  const response = await callClaude(apiKey, { ...options, stream: false }, label);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const data: ClaudeResponse = await response.json();

  const model = options.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  if (data.usage) {
    console.log(`[${label}] Tokens — in: ${data.usage.input_tokens}, out: ${data.usage.output_tokens}`);
    logTokenUsage(label, model, data.usage.input_tokens, data.usage.output_tokens);
  }

  const rawText = data.content?.[0]?.text ?? "";

  // Try direct JSON parse first, then extract from markdown code block
  let parsed: T;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    } else {
      console.error(`[${label}] Failed to parse Claude response:`, rawText.slice(0, 500));
      throw new Error("No se pudo interpretar la respuesta de Claude como JSON.");
    }
  }

  return { result: parsed, usage: data.usage };
}

/**
 * Generate embeddings using Voyage AI API (same model as qb19 backend: voyage-3, 1024 dims).
 * Returns null if VOYAGE_API_KEY is not set — allows graceful fallback.
 */
export async function getVoyageEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: [text.slice(0, 4000)], // Voyage max ~4K chars per input
        input_type: "query",
      }),
    });

    if (!response.ok) {
      console.warn("[voyage] Embedding API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.warn("[voyage] Embedding error:", err);
    return null;
  }
}
