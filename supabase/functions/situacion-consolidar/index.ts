/**
 * situacion-consolidar (Edge Function) — el bot de situaciones (spec §6).
 *
 * Cada corrida: situacion_ciclo (SQL: señales de memoria → calidad → situaciones
 * determinísticas) → situacion_candidatas (nuevas/empeoradas/mejoradas sin
 * redacción vigente) → por candidata situacion_contexto → Claude (Sonnet, JSON
 * cerrado) → situacion_redactar (solo título, resumen, recomendación, severidad
 * en banda, responsable, fusiones). La IA nunca toca clave, documentos,
 * evidencia ni estado. Cierra la corrida en situacion_corridas.
 *
 * Disparo: senales_push_terminado (al terminar el push horario de Odoo) y
 * pg_cron situacion_respaldo (si no corrió en 50 min).
 * Body opcional: { corrida: uuid, origen: "odoo"|"cron"|"manual", batch: 40, id: <situacion_id> (solo esa, aunque ya esté redactada), sin_ia: true }.
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody, type Client } from "../_shared/env.ts";
import { anthropicClient, claudeJSON, MODEL_BULK } from "../_shared/claude.ts";
import type Anthropic from "npm:@anthropic-ai/sdk@0.126.0";
import { SYSTEM, armarContexto, validarSalida, type Contexto } from "./prompt.ts";

const TIME_BUDGET_MS = 110_000;
const MAX_CANDIDATAS = 40;
const PROMPT_CHARS = 16_000;
const CONCURRENCIA = 4;   // llamadas a Claude en paralelo: una tarda ~7 s; en serie solo caben ~15 por corrida

async function redactarUna(supabase: Client, client: Anthropic, id: number, model: string, corridaId: number) {
  const { data: ctx, error } = await supabase.rpc("situacion_contexto", { p_id: id });
  if (error) throw new Error(`situacion_contexto: ${error.message}`);
  if (!ctx) throw new Error(`situación ${id} no existe`);
  const c = ctx as Contexto;
  const banda = { base: c.senal_config?.severidad_base ?? 1, max: c.senal_config?.severidad_max ?? 5, id, candidatos: (c.posibles_duplicados ?? []).map((d) => d.id) };
  const raw = await claudeJSON<Record<string, unknown>>(client, supabase, {
    model, system: SYSTEM, user: armarContexto(c, PROMPT_CHARS), max_tokens: 1200, effort: "low",
  }, "situacion-consolidar");
  const out = validarSalida(raw, banda);
  const { data: saved, error: saveErr } = await supabase.rpc("situacion_redactar", { p_id: id, p: out, p_modelo: model, p_corrida_id: corridaId });
  if (saveErr) throw new Error(`situacion_redactar: ${saveErr.message}`);
  return { id, titulo: out.titulo, severidad: out.severidad, fusiones: Number((saved as { fusiones?: number })?.fusiones ?? 0) };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;
  const body = await readBody(req);
  const started = Date.now();
  const origen = typeof body.origen === "string" ? body.origen : "manual";
  const batch = Math.min(Math.max(Number(body.batch ?? MAX_CANDIDATAS), 1), MAX_CANDIDATAS);
  const model = typeof body.model === "string" && body.model ? body.model : MODEL_BULK;
  const only = body.id ? Number(body.id) : null;

  // 1. Ciclo SQL (memoria → calidad → situaciones). Siempre, aunque la IA falle después.
  const { data: ciclo, error: cicloErr } = await supabase.rpc("situacion_ciclo", { p_corrida: typeof body.corrida === "string" ? body.corrida : crypto.randomUUID(), p_origen: origen });
  if (cicloErr) {
    await pipelineLog(supabase, "situacion_consolidar", "error", `situacion_ciclo: ${cicloErr.message}`, { origen });
    return json({ error: cicloErr.message }, 500);
  }
  const corridaId = Number((ciclo as { corrida_id: number }).corrida_id);

  // 2. Candidatas.
  let ids: number[] = [];
  if (only) ids = [only];
  else if (body.sin_ia !== true) {
    const { data: cand, error: candErr } = await supabase.rpc("situacion_candidatas", { p_limit: batch });
    if (candErr) {
      await pipelineLog(supabase, "situacion_consolidar", "error", `situacion_candidatas: ${candErr.message}`, { origen, corridaId });
      return json({ error: candErr.message, ciclo }, 500);
    }
    ids = ((cand ?? []) as { id: number }[]).map((c) => c.id);
  }

  // 3. Redacción.
  const results: Record<string, unknown>[] = [];
  const errores: string[] = [];
  let ok = 0, fusiones = 0;
  const client = ids.length ? await anthropicClient(supabase) : null;
  if (!client) {
    if (ids.length) errores.push("anthropic_api_key no configurado (env ni Vault)");
  } else {
    // Pool de CONCURRENCIA trabajadores sobre la misma cola; cada uno se detiene al agotarse el presupuesto de tiempo.
    const cola = [...ids];
    let sinTiempo = 0;
    const trabajador = async () => {
      for (let id = cola.shift(); id !== undefined; id = cola.shift()) {
        if (Date.now() - started > TIME_BUDGET_MS) { sinTiempo++; cola.unshift(id); return; }
        try {
          const r = await redactarUna(supabase, client, id, model, corridaId);
          ok++; fusiones += r.fusiones; results.push(r);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errores.push(`#${id}: ${message.slice(0, 200)}`);   // se reintenta en la siguiente corrida (ia_version sigue < version)
          results.push({ id, error: message.slice(0, 200) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, ids.length) }, trabajador));
    if (sinTiempo) errores.push(`presupuesto de tiempo agotado con ${cola.length} candidatas sin redactar`);
  }

  // 4. Tokens de esta corrida (token_usage) y cierre.
  const { data: tok } = await supabase.from("token_usage").select("input_tokens, output_tokens").eq("endpoint", "situacion-consolidar").gte("created_at", new Date(started).toISOString());
  const tokens = ((tok ?? []) as { input_tokens: number; output_tokens: number }[]).reduce((a, t) => ({ i: a.i + (t.input_tokens ?? 0), o: a.o + (t.output_tokens ?? 0) }), { i: 0, o: 0 });
  await supabase.rpc("situacion_corrida_cerrar", { p_id: corridaId, p: { n_candidatas: ids.length, n_redactadas: ok, n_fusiones: fusiones, tokens_in: tokens.i, tokens_out: tokens.o, modelo: ids.length ? model : null, errores } });
  const elapsed_s = Math.round((Date.now() - started) / 1000);
  const sit = (ciclo as { situaciones?: Record<string, unknown> }).situaciones ?? {};
  await pipelineLog(supabase, "situacion_consolidar", errores.length && !ok ? "error" : errores.length ? "warning" : "info",
    `Situación (${origen}): ${sit.nuevas ?? 0} nuevas, ${sit.actualizadas ?? 0} actualizadas, ${sit.resueltas ?? 0} resueltas; ${ok}/${ids.length} redactadas, ${fusiones} fusiones, ${errores.length} errores (${elapsed_s}s)`,
    { corrida_id: corridaId, origen, ciclo: sit, candidatas: ids.length, redactadas: ok, fusiones, errores, tokens, elapsed_s, model });
  return json({ ok: true, corrida_id: corridaId, ciclo, candidatas: ids.length, redactadas: ok, fusiones, errores, tokens, elapsed_s, results });
});
