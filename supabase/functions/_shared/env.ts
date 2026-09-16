/**
 * Utilidades comunes de las Edge Functions de memoria: cliente Supabase con
 * service role, autenticación de cron (x-cron-secret), respuestas JSON y log
 * a pipeline_logs (el watchdog lee la phase de cada pipeline).
 */
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// deno-lint-ignore no-explicit-any
export type Client = any;

export function serviceClient(): Client {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no inyectados");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Autoriza la llamada: cabecera `x-cron-secret` (o Bearer) igual al secreto
 * CRON_SECRET del entorno o, si no está, al guardado en Vault (`cron_secret`)
 * vía RPC edge_secret. Las funciones se despliegan con verify_jwt=false porque
 * pg_net las llama sin JWT de usuario.
 */
export async function authorizeCron(req: Request, supabase: Client): Promise<Response | null> {
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected) {
    const { data } = await supabase.rpc("edge_secret", { p_name: "cron_secret" });
    expected = data ? String(data) : "";
  }
  if (!expected) return json({ error: "cron_secret no configurado (Vault o env)" }, 503);
  if (provided !== expected) return json({ error: "Unauthorized" }, 401);
  return null;
}

export async function pipelineLog(
  supabase: Client,
  phase: string,
  level: "info" | "warning" | "error",
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from("pipeline_logs").insert({ level, phase, message, details: { ...details, runtime: "edge" } });
  } catch (err) {
    console.error("[pipelineLog]", err);
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
