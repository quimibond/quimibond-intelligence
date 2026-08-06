/**
 * Extractor de pendientes accionables del correo (fase C de "todo
 * conectado", 2026-08-06). Cron cada 2h.
 *
 * Lee hilos recientes de clientes reales y extrae con Claude pendientes
 * concretos y verificables: RFQs/cotizaciones con deadline, solicitudes de
 * documentos, compromisos de entrega, promesas de pago. Cada pendiente
 * cita su hilo fuente. NO es IA especulativa: si el correo no lo dice, no
 * se inventa (los tipos y campos están acotados por schema + constraint).
 *
 * Ciclo de vida:
 * - dedup por (thread_id, tipo) — upsert ignoreDuplicates
 * - auto-resolve: si el hilo tiene respuesta interna posterior a la
 *   detección, el pendiente de responder se marca resuelto
 * - expiración vía expire_email_pending_actions() (sin deadline >14d,
 *   deadline vencido >7d)
 *
 * Self-backfill: procesa hilos de los últimos 7 días que aún no tienen
 * pendiente registrado (15 por corrida), así la primera semana se cubre
 * sola sin parámetros.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { callClaudeJSON } from "@/lib/claude";

export const maxDuration = 300;

const THREADS_PER_RUN = 15;
const NOISE_SENDER =
  /(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|mailer|automated|donotreply)/i;

interface ExtractedPending {
  tipo: "rfq" | "cotizacion" | "solicitud_documento" | "compromiso_entrega" | "promesa_pago" | "otro";
  descripcion: string;
  deadline: string | null;
}

const EXTRACTION_SYSTEM = `Eres un extractor de pendientes accionables en correos comerciales de Quimibond (textil, México).

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

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado" }, { status: 503 });
  }

  const supabase = getServiceClient();
  const started = Date.now();

  try {
    // 1. Auto-resolve: hilos donde ya respondimos después de la detección
    const { data: resolved } = await supabase.rpc("analyst_query", {
      p_sql: `SELECT p.id FROM email_pending_actions p JOIN threads t ON t.id = p.thread_id
        WHERE p.status = 'open' AND p.tipo IN ('rfq','cotizacion','solicitud_documento')
        AND t.last_sender_type = 'internal' AND t.last_activity > p.detected_at LIMIT 100`,
    });
    const resolvedIds = Array.isArray(resolved) ? resolved.map((r: { id: number }) => r.id) : [];
    if (resolvedIds.length) {
      await supabase
        .from("email_pending_actions")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .in("id", resolvedIds);
    }

    // 2. Expirar viejos
    await supabase.rpc("expire_email_pending_actions");

    // 3. Candidatos: hilos de clientes reales, activos en 7d, sin pendiente registrado
    const { data: candidates } = await supabase.rpc("analyst_query", {
      p_sql: `SELECT t.id AS thread_id, t.subject, t.account, t.company_id, c.name AS company_name, t.last_sender
        FROM threads t
        JOIN companies c ON c.id = t.company_id AND c.is_customer AND coalesce(c.lifetime_value,0) > 0
        WHERE t.last_activity > now() - interval '7 days'
          AND t.message_count >= 1
          AND NOT EXISTS (SELECT 1 FROM email_pending_actions p WHERE p.thread_id = t.id)
        ORDER BY t.last_activity DESC
        LIMIT ${THREADS_PER_RUN}`,
    });

    const threads = (Array.isArray(candidates) ? candidates : []).filter(
      (t: { last_sender: string | null }) => !NOISE_SENDER.test(t.last_sender ?? ""),
    );

    let inserted = 0;
    let processed = 0;

    for (const t of threads as Array<{
      thread_id: number;
      subject: string | null;
      account: string | null;
      company_id: number | null;
      company_name: string | null;
    }>) {
      if (Date.now() - started > 240_000) break;

      const { data: msgs } = await supabase
        .from("emails")
        .select("id, email_date, sender, sender_type, body, snippet")
        .eq("thread_id", t.thread_id)
        .order("email_date", { ascending: false })
        .limit(6);
      if (!msgs?.length) {
        // Marcar como visto para no re-procesar hilos sin mensajes legibles
        await supabase.from("email_pending_actions").upsert(
          {
            thread_id: t.thread_id,
            tipo: "otro",
            descripcion: "(sin pendientes detectados)",
            status: "resolved",
            resolved_at: new Date().toISOString(),
            company_id: t.company_id,
            company_name: t.company_name,
            account: t.account,
          },
          { onConflict: "thread_id,tipo", ignoreDuplicates: true },
        );
        processed++;
        continue;
      }

      const conversation = msgs
        .reverse()
        .map(
          (m) =>
            `[${String(m.email_date).slice(0, 10)}] ${m.sender_type === "internal" ? "QUIMIBOND" : "CLIENTE"} (${m.sender}): ${String(m.body ?? m.snippet ?? "").replace(/\s+/g, " ").slice(0, 900)}`,
        )
        .join("\n---\n");

      try {
        const { result } = await callClaudeJSON<ExtractedPending[]>(
          apiKey,
          {
            max_tokens: 600,
            temperature: 0,
            system: EXTRACTION_SYSTEM,
            messages: [
              { role: "user", content: `Asunto: ${t.subject ?? "(sin asunto)"}\nCliente: ${t.company_name ?? "?"}\n\n${conversation}` },
            ],
          },
          "extract-pending",
        );

        const pendings = (Array.isArray(result) ? result : []).slice(0, 3);
        const sourceEmailId = msgs[msgs.length - 1]?.id ?? null;

        const rows = pendings.length
          ? pendings.map((p) => ({
              thread_id: t.thread_id,
              source_email_id: sourceEmailId,
              tipo: p.tipo,
              descripcion: String(p.descripcion).slice(0, 300),
              deadline: p.deadline && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline) ? p.deadline : null,
              company_id: t.company_id,
              company_name: t.company_name,
              account: t.account,
            }))
          : [
              // Sin pendientes: fila 'otro' resuelta = marca de "ya revisado"
              {
                thread_id: t.thread_id,
                source_email_id: sourceEmailId,
                tipo: "otro" as const,
                descripcion: "(sin pendientes detectados)",
                deadline: null,
                company_id: t.company_id,
                company_name: t.company_name,
                account: t.account,
                status: "resolved",
                resolved_at: new Date().toISOString(),
              },
            ];

        const { error } = await supabase
          .from("email_pending_actions")
          .upsert(rows, { onConflict: "thread_id,tipo", ignoreDuplicates: true });
        if (!error && pendings.length) inserted += pendings.length;
        processed++;
      } catch (err) {
        console.error(`[extract-pending] thread ${t.thread_id}`, err);
      }
    }

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "extract_pending",
      message: `Pendientes de correo: ${inserted} detectados en ${processed} hilos (${resolvedIds.length} auto-resueltos)`,
      details: { inserted, processed, auto_resolved: resolvedIds.length },
    });

    return NextResponse.json({ ok: true, inserted, processed, auto_resolved: resolvedIds.length });
  } catch (err) {
    console.error("[extract-pending] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
