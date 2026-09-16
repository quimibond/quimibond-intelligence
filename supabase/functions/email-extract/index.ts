/**
 * email-extract (Edge Function) — extractores acotados sobre el correo, con
 * Claude. Reemplaza a tres rutas de Vercel; el body elige la tarea:
 *   { "task": "pending" }       ← /api/pipeline/extract-pending (pendientes accionables por hilo)
 *   { "task": "demand" }        ← /api/pipeline/extract-demand (releases/forecasts en el cuerpo)
 *   { "task": "demand_files" }  ← /api/pipeline/extract-demand-files (Excel/CSV adjuntos)
 * pg_cron: memoria_extract_pending (:40 cada 2h), memoria_extract_demand (:50),
 * memoria_extract_demand_files (:55). NO es IA especulativa: schemas cerrados,
 * cada fila cita su hilo/correo fuente.
 */
import { serviceClient, authorizeCron, json, pipelineLog, readBody, type Client } from "../_shared/env.ts";
import { anthropicClient, claudeJSON, MODEL_BULK } from "../_shared/claude.ts";
import { GmailClient, loadServiceAccount, decodeBase64Url } from "../_shared/gmail.ts";

const TIME_BUDGET_MS = 120_000;
const NOISE_SENDER = /(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|mailer|automated|donotreply)/i;

interface ExtractedPending {
  tipo: "rfq" | "cotizacion" | "solicitud_documento" | "compromiso_entrega" | "promesa_pago" | "otro";
  descripcion: string;
  deadline: string | null;
}
interface DemandLine {
  product_ref: string | null;
  product_desc: string | null;
  qty: number;
  uom: string | null;
  period_label: string | null;
  demand_date: string | null;
}

const PENDING_SYSTEM = `Eres un extractor de pendientes accionables en correos comerciales de Quimibond (textil, México).

Lee la conversación y devuelve SOLO un array JSON (sin markdown) de pendientes que la CONTRAPARTE espera de Quimibond o que Quimibond comprometió, vigentes al final del hilo:

[{"tipo": "rfq|cotizacion|solicitud_documento|compromiso_entrega|promesa_pago|otro", "descripcion": "qué se espera, de quién, 1 línea", "deadline": "YYYY-MM-DD o null"}]

Reglas estrictas:
- Solo pendientes EXPLÍCITOS en el texto. Si no hay, devuelve [].
- "rfq"/"cotizacion": piden precio/cotización formal. Usa el due date si lo mencionan.
- "solicitud_documento": piden certificados, fichas, facturas, CoA, firmas.
- "compromiso_entrega": Quimibond prometió entregar algo en una fecha.
- "promesa_pago": el cliente prometió pagar (con fecha si la dan).
- Si el último mensaje ya resuelve el pendiente, NO lo incluyas.
- Máximo 3 pendientes por hilo. descripcion en español, concreta.`;

const DEMAND_SYSTEM = `Eres un extractor de demanda en correos comerciales de Quimibond (textil, México). Los clientes mandan releases semanales, forecasts y programas de recolección con cantidades de producto.

Devuelve SOLO un array JSON (sin markdown) con las líneas de demanda EXPLÍCITAS en el correo:

[{"product_ref": "clave del producto tal como aparece (ej. WJ053Q22JNT160) o null si solo hay descripción", "product_desc": "descripción corta o null", "qty": número, "uom": "m|yd|kg|rollos|pzas|lm o null", "period_label": "CW32, semana 33, agosto, etc. o null", "demand_date": "YYYY-MM-DD si hay fecha concreta o null"}]

Reglas estrictas:
- Solo cantidades que el CLIENTE pide/proyecta/agenda. NO extraigas montos de dinero, números de factura ni pesos de rollos.
- Si una tabla trae varias columnas de cantidad (yd, m, m2), usa la de METROS (m) si existe; si no, la principal.
- Si el correo no trae demanda (es cobranza, calidad, trámite), devuelve [].
- Máximo 15 líneas.`;

const DEMAND_FILES_SYSTEM = `Eres un extractor de demanda en archivos que clientes de Quimibond (textil, México) adjuntan a sus correos: releases semanales, forecasts y programas de recolección convertidos a CSV.

Devuelve SOLO un array JSON (sin markdown) con las líneas de demanda EXPLÍCITAS:

[{"product_ref": "clave del producto tal como aparece (ej. WJ053Q22JNT160) o null", "product_desc": "descripción corta o null", "qty": número, "uom": "m|yd|kg|rollos|pzas|lm o null", "period_label": "CW32, semana 33, agosto, etc. o null", "demand_date": "YYYY-MM-DD o null"}]

Reglas estrictas:
- Solo cantidades que el CLIENTE pide/proyecta/agenda. NO montos de dinero, números de factura, inventarios del cliente ni pesos de rollos.
- Si hay columnas por semana/mes (forecast), genera una línea por periodo con su period_label.
- Si el archivo no es de demanda (factura, estado de cuenta, ficha técnica), devuelve [].
- Máximo 25 líneas (prioriza las de mayor cantidad).`;

function demandRows(lines: DemandLine[], em: { email_id: number; thread_id: number | null; company_id: number | null; company_name: string | null }) {
  return lines.map((l) => ({
    source_email_id: em.email_id,
    thread_id: em.thread_id,
    company_id: em.company_id,
    company_name: em.company_name,
    product_ref: l.product_ref ? String(l.product_ref).trim().toUpperCase() : null,
    product_desc: l.product_desc ? String(l.product_desc).slice(0, 200) : null,
    qty: Number(l.qty),
    uom: l.uom ? String(l.uom).toLowerCase() : null,
    period_label: l.period_label ? String(l.period_label).slice(0, 40) : null,
    demand_date: l.demand_date && /^\d{4}-\d{2}-\d{2}$/.test(l.demand_date) ? l.demand_date : null,
  }));
}

// deno-lint-ignore no-explicit-any
async function taskPending(supabase: Client, client: any, started: number) {
  const { data: resolved } = await supabase.rpc("analyst_query", {
    p_sql: `SELECT p.id FROM email_pending_actions p JOIN threads t ON t.id = p.thread_id
      WHERE p.status = 'open' AND p.tipo IN ('rfq','cotizacion','solicitud_documento')
      AND t.last_sender_type = 'internal' AND t.last_activity > p.detected_at LIMIT 100`,
  });
  const resolvedIds = Array.isArray(resolved) ? resolved.map((r: { id: number }) => r.id) : [];
  if (resolvedIds.length) {
    await supabase.from("email_pending_actions").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", resolvedIds);
  }
  await supabase.rpc("expire_email_pending_actions");

  const { data: candidates } = await supabase.rpc("analyst_query", {
    p_sql: `SELECT t.id AS thread_id, t.subject, t.account, t.company_id, c.name AS company_name, t.last_sender
      FROM threads t
      JOIN companies c ON c.id = t.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
      WHERE t.last_activity > now() - interval '7 days'
        AND t.message_count >= 1
        AND NOT EXISTS (SELECT 1 FROM email_pending_actions p WHERE p.thread_id = t.id)
      ORDER BY t.last_activity DESC
      LIMIT 15`,
  });
  const threads = (Array.isArray(candidates) ? candidates : []).filter((t: { last_sender: string | null }) => !NOISE_SENDER.test(t.last_sender ?? ""));

  let inserted = 0;
  let processed = 0;
  for (const t of threads as { thread_id: number; subject: string | null; account: string | null; company_id: number | null; company_name: string | null }[]) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const { data: msgs } = await supabase
      .from("emails")
      .select("id, email_date, sender, sender_type, body_clean, body, snippet")
      .eq("thread_id", t.thread_id)
      .order("email_date", { ascending: false })
      .limit(6);
    const base = { thread_id: t.thread_id, company_id: t.company_id, company_name: t.company_name, account: t.account };
    if (!msgs?.length) {
      await supabase.from("email_pending_actions").upsert({ ...base, tipo: "otro", descripcion: "(sin pendientes detectados)", status: "resolved", resolved_at: new Date().toISOString() }, { onConflict: "thread_id,tipo", ignoreDuplicates: true });
      processed++;
      continue;
    }
    const conversation = [...msgs]
      .reverse()
      .map((m: { email_date: string; sender: string; sender_type: string; body_clean: string | null; body: string | null; snippet: string | null }) =>
        `[${String(m.email_date).slice(0, 10)}] ${m.sender_type === "internal" ? "QUIMIBOND" : "CLIENTE"} (${m.sender}): ${String(m.body_clean ?? m.body ?? m.snippet ?? "").replace(/\s+/g, " ").slice(0, 900)}`)
      .join("\n---\n");
    try {
      const result = await claudeJSON<ExtractedPending[]>(client, supabase, {
        model: MODEL_BULK,
        system: PENDING_SYSTEM,
        user: `Asunto: ${t.subject ?? "(sin asunto)"}\nCliente: ${t.company_name ?? "?"}\n\n${conversation}`,
        max_tokens: 800,
        effort: "low",
      }, "extract-pending");
      const pendings = (Array.isArray(result) ? result : []).slice(0, 3);
      const sourceEmailId = msgs[0]?.id ?? null;
      const rows = pendings.length
        ? pendings.map((p) => ({ ...base, source_email_id: sourceEmailId, tipo: p.tipo, descripcion: String(p.descripcion).slice(0, 300), deadline: p.deadline && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline) ? p.deadline : null }))
        : [{ ...base, source_email_id: sourceEmailId, tipo: "otro" as const, descripcion: "(sin pendientes detectados)", deadline: null, status: "resolved", resolved_at: new Date().toISOString() }];
      const { error } = await supabase.from("email_pending_actions").upsert(rows, { onConflict: "thread_id,tipo", ignoreDuplicates: true });
      if (!error && pendings.length) inserted += pendings.length;
      processed++;
    } catch (err) {
      console.error(`[extract-pending] thread ${t.thread_id}`, err instanceof Error ? err.message : err);
    }
  }
  await pipelineLog(supabase, "extract_pending", "info", `Pendientes de correo: ${inserted} detectados en ${processed} hilos (${resolvedIds.length} auto-resueltos)`, { inserted, processed, auto_resolved: resolvedIds.length });
  return { inserted, processed, auto_resolved: resolvedIds.length };
}

// deno-lint-ignore no-explicit-any
async function taskDemand(supabase: Client, client: any, started: number) {
  const { data: candidates } = await supabase.rpc("analyst_query", {
    p_sql: `SELECT e.id AS email_id, e.thread_id, e.company_id, c.name AS company_name,
        e.subject, left(coalesce(e.body_clean, e.body, e.snippet, ''), 6000) AS cuerpo
      FROM emails e
      JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
      WHERE e.sender_type = 'external'
        AND e.email_date > now() - interval '7 days'
        AND e.sender !~* '(no-?reply|postmaster|notificacion|newsletter|digest)'
        AND (e.subject ~* '(release|forecast|programa|recolec|pedido|demanda|requerimiento|schedule|CW[0-9])'
          OR coalesce(e.body_clean, e.body) ~* '(release de|forecast|programa de (entrega|recolec)|favor de ajustar cantidades)')
        AND NOT EXISTS (SELECT 1 FROM demand_scan_log s WHERE s.email_id = e.id)
      ORDER BY e.email_date DESC
      LIMIT 12`,
  });
  const emails = Array.isArray(candidates) ? candidates : [];
  let signals = 0;
  let scanned = 0;
  for (const em of emails as { email_id: number; thread_id: number | null; company_id: number | null; company_name: string | null; subject: string | null; cuerpo: string }[]) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const result = await claudeJSON<DemandLine[]>(client, supabase, {
        model: MODEL_BULK,
        system: DEMAND_SYSTEM,
        user: `Cliente: ${em.company_name ?? "?"}\nAsunto: ${em.subject ?? ""}\n\n${em.cuerpo}`,
        max_tokens: 1500,
        effort: "low",
      }, "extract-demand");
      const lines = (Array.isArray(result) ? result : []).filter((l) => Number(l.qty) > 0).slice(0, 15);
      if (lines.length) {
        const { error } = await supabase.from("customer_demand_signals").upsert(demandRows(lines, em), { onConflict: "source_email_id,product_ref,period_label", ignoreDuplicates: true });
        if (!error) signals += lines.length;
      }
      await supabase.from("demand_scan_log").upsert({ email_id: em.email_id, signals_found: lines.length }, { onConflict: "email_id", ignoreDuplicates: true });
      scanned++;
    } catch (err) {
      console.error(`[extract-demand] email ${em.email_id}`, err instanceof Error ? err.message : err);
    }
  }
  await pipelineLog(supabase, "extract_demand", "info", `Demanda de clientes: ${signals} líneas extraídas de ${scanned} correos`, { signals, scanned });
  return { signals, scanned };
}

async function sheetToText(bytes: Uint8Array): Promise<string> {
  const XLSX = await import("npm:xlsx@0.18.5");
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 3)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (csv.trim()) parts.push(`--- Hoja: ${name} ---\n${csv.slice(0, 8000)}`);
  }
  return parts.join("\n\n").slice(0, 16000);
}

// deno-lint-ignore no-explicit-any
async function taskDemandFiles(supabase: Client, client: any, started: number) {
  const sa = await loadServiceAccount(supabase);
  if (!sa) throw new Error("google_service_account_json no configurado");
  const { data: candidates } = await supabase.rpc("analyst_query", {
    p_sql: `SELECT e.id AS email_id, e.thread_id, e.company_id, c.name AS company_name,
        e.subject, e.gmail_message_id, e.account, e.attachments
      FROM emails e
      JOIN companies c ON c.id = e.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
      WHERE e.sender_type = 'external'
        AND e.email_date > now() - interval '7 days'
        AND e.has_attachments
        AND e.attachments::text ~* '(xlsx|xls|csv)'
        AND (e.subject ~* '(release|forecast|programa|recolec|pedido|demanda|requerimiento|schedule|CW[0-9])'
          OR e.attachments::text ~* '(release|forecast|programa|pedido|demanda|schedule)')
        AND NOT EXISTS (SELECT 1 FROM demand_scan_log s WHERE s.email_id = e.id AND s.attachments_scanned)
      ORDER BY e.email_date DESC
      LIMIT 4`,
  });
  const emails = Array.isArray(candidates) ? candidates : [];
  let signals = 0;
  let scanned = 0;
  let files = 0;
  let parsedBytes = 0;
  const clients = new Map<string, GmailClient>();
  for (const em of emails as { email_id: number; thread_id: number | null; company_id: number | null; company_name: string | null; subject: string | null; gmail_message_id: string; account: string; attachments: { filename?: string; mimeType?: string; size?: number; attachmentId?: string }[] | null }[]) {
    if (Date.now() - started > TIME_BUDGET_MS || parsedBytes > 1_500_000) break;
    try {
      const sheets = (em.attachments ?? []).filter((a) => a.attachmentId && (/(spreadsheetml|ms-excel|text\/csv|application\/csv)/i.test(a.mimeType ?? "") || /\.(xlsx|xls|csv)$/i.test(a.filename ?? "")) && (a.size ?? 0) < 1_000_000);
      const texts: string[] = [];
      if (sheets.length) {
        let gmail = clients.get(em.account);
        if (!gmail) {
          gmail = new GmailClient(sa, em.account);
          clients.set(em.account, gmail);
        }
        for (const att of sheets.slice(0, 2)) {
          try {
            const r = await gmail.attachmentGet(em.gmail_message_id, att.attachmentId!);
            if (!r.data) continue;
            const bytes = decodeBase64Url(r.data);
            parsedBytes += bytes.length;
            const text = await sheetToText(bytes);
            if (text.trim()) {
              texts.push(`Archivo: ${att.filename ?? "adjunto"}\n${text}`);
              files++;
            }
          } catch (err) {
            console.error(`[extract-demand-files] attachment ${att.filename}`, err instanceof Error ? err.message : err);
          }
        }
      }
      let lines: DemandLine[] = [];
      if (texts.length) {
        const result = await claudeJSON<DemandLine[]>(client, supabase, {
          model: MODEL_BULK,
          system: DEMAND_FILES_SYSTEM,
          user: `Cliente: ${em.company_name ?? "?"}\nAsunto del correo: ${em.subject ?? ""}\n\n${texts.join("\n\n")}`,
          max_tokens: 2500,
          effort: "low",
        }, "extract-demand-files");
        lines = (Array.isArray(result) ? result : []).filter((l) => Number(l.qty) > 0).slice(0, 25);
      }
      if (lines.length) {
        const { error } = await supabase.from("customer_demand_signals").upsert(demandRows(lines, em), { onConflict: "source_email_id,product_ref,period_label", ignoreDuplicates: true });
        if (!error) signals += lines.length;
      }
      await supabase.from("demand_scan_log").upsert({ email_id: em.email_id, attachments_scanned: true, attachment_signals: lines.length }, { onConflict: "email_id" });
      scanned++;
    } catch (err) {
      console.error(`[extract-demand-files] email ${em.email_id}`, err instanceof Error ? err.message : err);
    }
  }
  await pipelineLog(supabase, "extract_demand", "info", `Demanda (adjuntos): ${signals} líneas de ${files} archivos en ${scanned} correos`, { signals, files, scanned, source: "attachments" });
  return { signals, files, scanned };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const denied = await authorizeCron(req, supabase);
  if (denied) return denied;

  const body = await readBody(req);
  const task = String(body.task ?? "");
  if (!["pending", "demand", "demand_files"].includes(task)) return json({ error: "body.task debe ser pending | demand | demand_files" }, 400);

  const client = await anthropicClient(supabase);
  if (!client) {
    await pipelineLog(supabase, task === "pending" ? "extract_pending" : "extract_demand", "error", "Extractor: anthropic_api_key no configurado (env ni Vault)");
    return json({ error: "anthropic_api_key no configurado" }, 503);
  }
  const started = Date.now();
  try {
    const result = task === "pending" ? await taskPending(supabase, client, started) : task === "demand" ? await taskDemand(supabase, client, started) : await taskDemandFiles(supabase, client, started);
    return json({ ok: true, task, ...result, elapsed_s: Math.round((Date.now() - started) / 1000) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email-extract:${task}]`, message);
    await pipelineLog(supabase, task === "pending" ? "extract_pending" : "extract_demand", "error", `Extractor ${task} falló: ${message.slice(0, 300)}`);
    return json({ error: message }, 500);
  }
});
