/**
 * Claude API desde Edge Functions con el SDK oficial (npm:@anthropic-ai/sdk).
 * La API key se lee de env ANTHROPIC_API_KEY o de Vault (anthropic_api_key).
 * Cada llamada registra tokens en token_usage (misma tabla que usaba Vercel).
 *
 * Modelos: `claude-opus-5` para el resumen ejecutivo (una llamada al día);
 * `claude-sonnet-5` para los extractores en lote. Override con CLAUDE_MODEL.
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.126.0";
import { loadSecret, type Client } from "./env.ts";

export const MODEL_MAIN = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5";
export const MODEL_BULK = Deno.env.get("CLAUDE_MODEL_BULK") ?? "claude-sonnet-5";

export async function anthropicClient(supabase: Client): Promise<Anthropic | null> {
  const apiKey = await loadSecret(supabase, "ANTHROPIC_API_KEY", "anthropic_api_key");
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 3 });
}

export interface ClaudeCall {
  model: string;
  system: string;
  user: string;
  max_tokens: number;
  effort?: "low" | "medium" | "high";
}

/** Llama a Claude y devuelve el texto (bloques text concatenados). */
export async function claudeText(client: Anthropic, supabase: Client, call: ClaudeCall, label: string): Promise<string> {
  const res = await client.messages.create({
    model: call.model,
    max_tokens: call.max_tokens,
    system: call.system,
    messages: [{ role: "user", content: call.user }],
    output_config: { effort: call.effort ?? "medium" },
  });
  if (res.usage) {
    const cacheRead = res.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = res.usage.cache_creation_input_tokens ?? 0;
    try {
      await supabase.from("token_usage").insert({
        endpoint: label,
        model: call.model,
        input_tokens: res.usage.input_tokens + cacheWrite + Math.ceil(cacheRead * 0.1),
        output_tokens: res.usage.output_tokens,
      });
    } catch (err) {
      console.warn("[token_usage]", err);
    }
  }
  if (res.stop_reason === "refusal") {
    throw new Error(`Claude rechazó la solicitud (${res.stop_details?.category ?? "sin categoría"})`);
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Llama a Claude y parsea la respuesta como JSON (directo o dentro de ```json). */
export async function claudeJSON<T>(client: Anthropic, supabase: Client, call: ClaudeCall, label: string): Promise<T> {
  const raw = await claudeText(client, supabase, call, label);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1].trim()) as T;
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) return JSON.parse(arr[0]) as T;
    console.error(`[${label}] respuesta no JSON:`, raw.slice(0, 300));
    throw new Error("No se pudo interpretar la respuesta de Claude como JSON.");
  }
}
