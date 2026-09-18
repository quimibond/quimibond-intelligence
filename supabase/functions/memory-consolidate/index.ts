/**
 * memory-consolidate (Edge Function) — resumen vivo por conversación + hechos
 * con vigencia + grafo, con Claude (Sonnet, lote).
 *
 * Cada corrida (pg_cron memoria_consolidar, cada 5 min) toma las conversaciones de
 * clientes/proveedores de Odoo con correo posterior a su último resumen
 * (RPC memoria_hilos_pendientes: una fila por conversación, agrupando los hilos
 * que Gmail abre por buzón), lee sus mensajes sin duplicar
 * (memoria_hilo_mensajes), pide a Claude un JSON cerrado y lo guarda con
 * memoria_guardar_consolidacion (memoria_thread_summaries, memoria_facts,
 * kg_nodes/kg_edges). Incremental: si ya había resumen, manda el resumen
 * anterior + solo los correos nuevos.
 *
 * Body opcional: { thread_id } (una conversación, para probar),
 * { batch: 10, days: 120 }.
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody, type Client } from "../_shared/env.ts";
import { anthropicClient, claudeJSON, MODEL_BULK } from "../_shared/claude.ts";

const TIME_BUDGET_MS = 110_000;
const MAX_CHARS = 18_000;
const MAX_ADJ_CHARS_MSG = 2_500; // texto de adjuntos por correo
const MAX_ADJ_CHARS_CONV = 8_000; // y por conversación
const NOISE_SENDER = /(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|mailer|automated|donotreply)/i;

interface Pending {
  thread_id: number;
  conv_key: string;
  thread_ids: number[];
  subject: string | null;
  account: string | null;
  company_id: number;
  company_name: string;
  is_customer: boolean;
  is_supplier: boolean;
  message_count: number;
  last_activity: string;
  summarized_through: string | null;
  prev_version: number | null;
}
interface Msg {
  id: number;
  thread_id: number;
  account: string;
  email_date: string;
  sender: string;
  sender_type: "internal" | "external";
  recipient: string | null;
  cc: string | null;
  subject: string | null;
  cuerpo: string;
  adjuntos: string | null;
  adjuntos_texto: string | null;
}
interface Consolidado {
  tema: string;
  resumen: string;
  estado: "abierto" | "cerrado" | "informativo";
  esperando_a: "nosotros" | "ellos" | "nadie";
  tono: "positivo" | "neutral" | "tenso";
  acuerdos: { que: string; fecha: string | null }[];
  pendientes: { que: string; quien: "nosotros" | "ellos"; vence: string | null }[];
  hechos: { sobre: "empresa" | "contacto"; email?: string | null; categoria: string; hecho: string; vigente_desde: string | null; confianza?: number }[];
  personas: { email: string; nombre: string | null; rol: string | null; lado: "quimibond" | "contraparte" }[];
}

const SYSTEM = `Eres la memoria institucional de Quimibond (textil, México: telas, entretelas, no tejidos). Lees una conversación de correo entre Quimibond y un cliente o proveedor y la conviertes en memoria útil para quien la retome mañana sin haberla leído.

Devuelve SOLO un objeto JSON (sin markdown) con este esquema exacto:
{
 "tema": "≤ 12 palabras, concreto (qué producto/pedido/asunto)",
 "resumen": "3 a 6 frases en español: qué se pidió, qué se respondió, en qué quedó. Con cifras, fechas, claves de producto y nombres cuando aparecen.",
 "estado": "abierto | cerrado | informativo",
 "esperando_a": "nosotros | ellos | nadie",
 "tono": "positivo | neutral | tenso",
 "acuerdos": [{"que": "acuerdo explícito (precio, fecha, condición)", "fecha": "YYYY-MM-DD o null"}],
 "pendientes": [{"que": "qué falta y quién lo pidió", "quien": "nosotros | ellos", "vence": "YYYY-MM-DD o null"}],
 "hechos": [{"sobre": "empresa | contacto", "email": "correo del contacto si sobre=contacto, si no null", "categoria": "condiciones_pago | precio | producto | logistica | calidad | contacto_clave | proceso | preferencia | riesgo | otro", "hecho": "1 frase, durable y verificable (no un evento puntual)", "vigente_desde": "YYYY-MM-DD o null", "confianza": 0.5 a 1}],
 "personas": [{"email": "correo", "nombre": "nombre o null", "rol": "puesto/área si se infiere, si no null", "lado": "quimibond | contraparte"}]
}

Reglas estrictas:
- Solo lo que está en el texto. Nada inventado; si no hay dato, null o lista vacía.
- "estado": abierto si alguien debe algo todavía; cerrado si el asunto quedó resuelto; informativo si es aviso sin acción (notificación, cortesía, release ya procesado).
- "esperando_a": nosotros = Quimibond debe responder/entregar/cotizar; ellos = la contraparte debe algo; nadie = cerrado o informativo.
- "hechos" son cosas que siguen siendo verdad después de esta conversación: condiciones de pago pactadas, precios acordados, productos que compra, requisitos de calidad o empaque, ventanas de entrega, quién decide, preferencias de trato, riesgos (quejas repetidas, atrasos de pago). Máximo 6. NO conviertas cada mensaje en un hecho.
- "personas": los correos que participan (máximo 8, los más relevantes), con su lado. Rol solo si el texto lo dice o lo hace evidente (firma, cargo).
- Si hay un "Resumen anterior", intégralo: el resumen nuevo describe TODA la conversación hasta hoy, no solo los correos nuevos; conserva los acuerdos que siguen vigentes y quita los pendientes ya resueltos.
- Los bloques "[adjunto: nombre] …" son el texto extraído de archivos adjuntos (cotizaciones, órdenes, fichas, releases). Úsalos igual que el cuerpo: de ahí salen precios, cantidades, claves y condiciones. Si el texto es una tabla aplanada, léela con cuidado.
- Español neutro, sin adjetivos de relleno. Nunca copies firmas ni avisos legales.`;

function fmtMsg(m: Msg, adjBudget: { left: number }): string {
  const who = m.sender_type === "internal" ? "QUIMIBOND" : "CONTRAPARTE";
  const to = m.recipient ? ` → ${String(m.recipient).slice(0, 120)}` : "";
  const cc = m.cc ? ` (cc ${String(m.cc).slice(0, 80)})` : "";
  const adj = m.adjuntos ? `\n[adjuntos: ${m.adjuntos.slice(0, 200)}]` : "";
  // Texto de los adjuntos (memoria_hilo_mensajes ya lo dedup por sha256 y lo
  // recorta a 2,500 por archivo); aquí se acota por correo y por conversación.
  let txt = "";
  if (m.adjuntos_texto && adjBudget.left > 200) {
    txt = m.adjuntos_texto.slice(0, Math.min(MAX_ADJ_CHARS_MSG, adjBudget.left));
    adjBudget.left -= txt.length;
    txt = `\n${txt}`;
  }
  return `[${String(m.email_date).slice(0, 16).replace("T", " ")}] ${who} ${m.sender}${to}${cc}\n${m.cuerpo.replace(/\s+/g, " ").trim()}${adj}${txt}`;
}

async function consolidateOne(supabase: Client, client: any, p: Pending, model: string) {
  p.thread_ids = (p.thread_ids ?? [p.thread_id]).map(Number);
  const { data: rows, error } = await supabase.rpc("memoria_hilo_mensajes", { p_thread_ids: p.thread_ids, p_limit: 40 });
  if (error) throw new Error(`memoria_hilo_mensajes: ${error.message}`);
  const all = ((rows ?? []) as Msg[]).slice().reverse(); // ascendente
  if (!all.length) return { skipped: "sin mensajes" };

  let prev: { resumen: string; tema: string | null; acuerdos: unknown; pendientes: unknown; estado: string } | null = null;
  let fresh = all;
  if (p.summarized_through) {
    let { data: ps } = await supabase.from("memoria_thread_summaries").select("tema, resumen, estado, acuerdos, pendientes")
      .eq("conv_key", p.conv_key).order("summarized_through", { ascending: false }).limit(1);
    if (!ps?.length) {
      ({ data: ps } = await supabase.from("memoria_thread_summaries").select("tema, resumen, estado, acuerdos, pendientes")
        .in("thread_id", p.thread_ids).order("summarized_through", { ascending: false }).limit(1));
    }
    prev = ps?.[0] ?? null;
    const cut = new Date(p.summarized_through).getTime();
    fresh = all.filter((m) => new Date(m.email_date).getTime() > cut);
    if (!fresh.length) {
      // Nada nuevo (ya cubierto): solo mueve la marca para no reintentar.
      await supabase.from("memoria_thread_summaries").update({ summarized_through: p.last_activity, updated_at: new Date().toISOString() }).eq("conv_key", p.conv_key);
      return { skipped: "sin correos nuevos" };
    }
  }
  const context = prev ? all.filter((m) => !fresh.includes(m)).slice(-2) : [];

  // Presupuesto de caracteres: los más recientes completos, los viejos recortados.
  const parts: string[] = [];
  let used = 0;
  const adjBudget = { left: MAX_ADJ_CHARS_CONV };
  const ordered = [...context.map((m) => ({ m, ctx: true })), ...fresh.map((m) => ({ m, ctx: false }))];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { m, ctx } = ordered[i];
    let txt = fmtMsg(m, ctx ? { left: 0 } : adjBudget);
    if (ctx) txt = `(ya resumido) ${txt.slice(0, 700)}`;
    const room = MAX_CHARS - used;
    if (room <= 300) break;
    if (txt.length > room) txt = txt.slice(0, room - 20) + " […]";
    parts.unshift(txt);
    used += txt.length;
  }

  const header = [
    `Contraparte: ${p.company_name} (${p.is_customer ? "cliente" : ""}${p.is_customer && p.is_supplier ? " y " : ""}${p.is_supplier ? "proveedor" : ""})`,
    `Asunto: ${p.subject ?? "(sin asunto)"}`,
    `Buzones de Quimibond en la conversación: ${[...new Set(all.map((m) => m.account))].join(", ")}`,
    `Hoy: ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");
  const prevBlock = prev
    ? `\n\nResumen anterior (${prev.estado}): ${prev.tema ? prev.tema + " — " : ""}${prev.resumen}\nAcuerdos previos: ${JSON.stringify(prev.acuerdos ?? [])}\nPendientes previos: ${JSON.stringify(prev.pendientes ?? [])}\n\nCorreos NUEVOS desde entonces:`
    : "\n\nConversación:";

  const out = await claudeJSON<Consolidado>(client, supabase, {
    model,
    system: SYSTEM,
    user: `${header}${prevBlock}\n\n${parts.join("\n---\n")}`,
    max_tokens: 3000,
    effort: "low",
  }, "memory-consolidate");

  const payload = {
    ...out,
    conv_key: p.conv_key,
    thread_ids: p.thread_ids,
    summarized_through: all[all.length - 1].email_date,
    emails_seen: all.length,
    email_ids: fresh.slice(-8).map((m) => m.id),
  };
  const { data: saved, error: saveErr } = await supabase.rpc("memoria_guardar_consolidacion", { p_thread_id: p.thread_id, p: payload, p_model: model });
  if (saveErr) throw new Error(`memoria_guardar_consolidacion: ${saveErr.message}`);
  return { saved, tema: out.tema, estado: out.estado, esperando_a: out.esperando_a, nuevos: fresh.length, hechos: out.hechos?.length ?? 0 };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;
  const body = await readBody(req);
  const batch = Math.min(Math.max(Number(body.batch ?? 10), 1), 25);
  const days = Math.min(Math.max(Number(body.days ?? 120), 1), 400);
  const model = typeof body.model === "string" && body.model ? body.model : MODEL_BULK;
  const only = body.thread_id ? Number(body.thread_id) : null;

  const client = await anthropicClient(supabase);
  if (!client) {
    await pipelineLog(supabase, "memory_consolidate", "error", "Consolidación: anthropic_api_key no configurado (env ni Vault)");
    return json({ error: "anthropic_api_key no configurado" }, 503);
  }
  const started = Date.now();
  let pending: Pending[] = [];
  if (only) {
    const { data: all, error } = await supabase.rpc("memoria_hilos_pendientes", { p_days: 400, p_limit: 5000 });
    if (error) return json({ error: error.message }, 500);
    pending = ((all ?? []) as Pending[]).filter((p) => p.thread_id === only || p.thread_ids.includes(only));
    if (!pending.length) {
      // Forzar aunque ya esté al día: reconstruye la fila mínima.
      const { data: t } = await supabase.from("threads").select("id, conv_key, gmail_thread_id, subject, account, company_id, message_count, last_activity").eq("id", only).maybeSingle();
      if (!t) return json({ error: `thread ${only} no existe` }, 404);
      const { data: c } = await supabase.from("companies").select("name, is_customer, is_supplier").eq("id", t.company_id).maybeSingle();
      const { data: sib } = await supabase.from("threads").select("id").eq("conv_key", t.conv_key ?? t.gmail_thread_id);
      pending = [{
        thread_id: t.id, conv_key: t.conv_key ?? t.gmail_thread_id, thread_ids: (sib ?? []).map((s: { id: number }) => s.id).sort((a: number, b: number) => a - b),
        subject: t.subject, account: t.account, company_id: t.company_id, company_name: c?.name ?? "?", is_customer: !!c?.is_customer, is_supplier: !!c?.is_supplier,
        message_count: t.message_count, last_activity: t.last_activity, summarized_through: null, prev_version: null,
      }];
    }
  } else {
    const { data, error } = await supabase.rpc("memoria_hilos_pendientes", { p_days: days, p_limit: batch * 2 });
    if (error) {
      await pipelineLog(supabase, "memory_consolidate", "error", `memoria_hilos_pendientes: ${error.message}`);
      return json({ error: error.message }, 500);
    }
    pending = ((data ?? []) as Pending[]).filter((p) => !NOISE_SENDER.test(p.account ?? "")).slice(0, batch);
  }

  const results: Record<string, unknown>[] = [];
  let ok = 0, failed = 0, skipped = 0, facts = 0;
  for (const p of pending) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const r = await consolidateOne(supabase, client, p, model);
      if ("skipped" in r) skipped++; else { ok++; facts += Number(r.hechos ?? 0); }
      results.push({ thread_id: p.thread_id, company: p.company_name, ...r });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[memory-consolidate] thread ${p.thread_id}`, message);
      results.push({ thread_id: p.thread_id, company: p.company_name, error: message.slice(0, 200) });
    }
  }
  const elapsed_s = Math.round((Date.now() - started) / 1000);
  await pipelineLog(supabase, "memory_consolidate", failed && !ok ? "error" : "info",
    `Consolidación: ${ok} conversaciones resumidas, ${facts} hechos, ${skipped} al día, ${failed} fallidas (${elapsed_s}s)`,
    { ok, failed, skipped, facts, elapsed_s, model, batch: pending.length });
  return json({ ok: true, resumidas: ok, fallidas: failed, al_dia: skipped, hechos: facts, elapsed_s, results });
});
