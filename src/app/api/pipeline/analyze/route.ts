/**
 * Pipeline Analyze v4 — Fast parallel email processing.
 *
 * Two scopes (Fase 2 — 13-abr-2026):
 * - scope=normal (default): emails_date >= NOW() - 14 days. Latencia baja
 *   para correo reciente. Corre cada 5 min.
 * - scope=backfill: email_date < NOW() - 14 days. Drena el historico de
 *   ~98k emails sin procesar. Oldest-first, sin cutoff inferior.
 *   Corre cada 5 min en paralelo al normal. No-op cuando remaining=0.
 *
 * Key changes from v3:
 * 1. PRE-FILTER: Skip noise emails without calling Claude (~30% of total)
 * 2. HAIKU: Use claude-haiku for extraction (3x faster, 10x cheaper)
 * 3. PARALLEL: Process up to 12 mini-batches of 5 emails simultaneously
 * 4. NO ACCOUNT GROUPING: Just grab the oldest unprocessed emails
 * 5. MORE CONTENT: 800 chars per email body instead of 400
 *
 * Throughput: ~60 emails analyzed per invocation (was ~40 con MAX_PARALLEL=8).
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { sanitizeEmailForClaude } from "@/lib/sanitize";

export const maxDuration = 300;

/** Patterns for emails that are noise and don't need Claude analysis */
const NOISE_PATTERNS = [
  /^Comunicación interna:\s*@/i,              // Odoo internal @mentions
  /disponible para su revisión/i,             // Odoo order notifications
  /Solicitud de firma/i,                       // Signature requests
  /^Hola,\s*Su orden \w+ por un importe de/i, // Odoo quote/order template
  /Intelligence Briefing/i,                    // Our own system emails
  /Bandwidth quota exceeded/i,                 // Gmail API errors
  /Vercel .* deployment/i,                     // Vercel deploy notifications
];

const NOISE_SENDERS = [
  "noreply@", "no-reply@", "notifications@", "notification@",
  "mailer-daemon@", "postmaster@", "clic@", "marketing@",
  "promo@", "newsletter@", "info@zacson", "ventas@zacson",
];

/** Spam/marketing domains — auto-skip without Claude */
const NOISE_DOMAINS = [
  "zacson-cursos.com", "mailchimp.com", "sendgrid.net",
  "constantcontact.com", "hubspot.com",
];

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });

    const supabase = getServiceClient();
    const start = Date.now();

    // scope=backfill drena el historico (> 14d). Normal atiende los ultimos 14d.
    const scope = request.nextUrl.searchParams.get("scope") === "backfill" ? "backfill" : "normal";

    // ── Step 1: Load unprocessed emails ─────────────────────────────────
    const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
    let query = supabase
      .from("emails")
      .select("id, account, sender, recipient, subject, body, snippet, email_date, sender_type, has_attachments, attachments")
      .eq("kg_processed", false)
      .order("email_date", { ascending: true }) // oldest first (within the chosen window)
      .limit(250);
    query = scope === "backfill" ? query.lt("email_date", cutoff) : query.gte("email_date", cutoff);
    const { data: unprocessed, error: queryErr } = await query;

    if (queryErr) return NextResponse.json({ error: queryErr.message }, { status: 500 });
    if (!unprocessed?.length) return NextResponse.json({ success: true, message: "No pending emails", all_processed: true });

    // ── Step 2: Pre-filter noise without Claude ─────────────────────────
    const noiseIds: number[] = [];
    const meaningful: typeof unprocessed = [];

    for (const email of unprocessed) {
      if (isNoise(email)) {
        noiseIds.push(email.id);
      } else {
        meaningful.push(email);
      }
    }

    // Mark noise as processed immediately
    if (noiseIds.length > 0) {
      await markProcessed(supabase, noiseIds);
    }

    if (!meaningful.length) {
      return NextResponse.json({
        success: true,
        noise_skipped: noiseIds.length,
        analyzed: 0,
        message: "All emails were noise",
      });
    }

    // ── Step 3: Split into mini-batches and process in parallel ─────────
    // BATCH_SIZE=5 previene truncation de output (10 emails × JSON rico hit 4K tokens).
    // MAX_PARALLEL subido de 8 → 12 (13-abr) para drenar mejor el backlog historico.
    // Haiku maneja 12 llamadas concurrentes sin hit rate limits al tier actual.
    const BATCH_SIZE = 5;
    const MAX_PARALLEL = 12;
    const batches: typeof meaningful[] = [];

    for (let i = 0; i < meaningful.length && batches.length < MAX_PARALLEL; i += BATCH_SIZE) {
      batches.push(meaningful.slice(i, i + BATCH_SIZE));
    }

    let totalEntities = 0, totalFacts = 0, totalRelationships = 0, totalActions = 0;
    let processedIds: number[] = [];
    let errors = 0;

    const results = await Promise.allSettled(
      batches.map(batch => processBatch(apiKey, supabase, batch))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const r = result.value;
        totalEntities += r.entities;
        totalFacts += r.facts;
        totalRelationships += r.relationships;
        totalActions += r.actions;
        processedIds = processedIds.concat(r.processedIds);
      } else {
        console.error("[analyze] Batch failed:", result.reason);
        errors++;
      }
    }

    // Mark successfully analyzed emails as processed
    if (processedIds.length > 0) {
      await markProcessed(supabase, processedIds);
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    const remaining = unprocessed.length - noiseIds.length - processedIds.length;

    // Log summary
    await supabase.from("pipeline_logs").insert({
      level: errors > 0 ? "warning" : "info",
      phase: "account_analysis",
      message: `[${scope}] Batch: ${processedIds.length} analyzed, ${noiseIds.length} noise skipped, ${errors} errors in ${elapsed}s`,
      details: {
        scope,
        analyzed: processedIds.length,
        noise_skipped: noiseIds.length,
        entities: totalEntities,
        facts: totalFacts,
        relationships: totalRelationships,
        actions: totalActions,
        errors,
        elapsed_s: elapsed,
        remaining,
      },
    });

    return NextResponse.json({
      success: true,
      scope,
      analyzed: processedIds.length,
      noise_skipped: noiseIds.length,
      data_extracted: { entities: totalEntities, facts: totalFacts, relationships: totalRelationships, actions: totalActions },
      errors,
      elapsed_s: elapsed,
      remaining,
    });
  } catch (err) {
    console.error("[analyze] FATAL:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Noise detection (no Claude needed) ──────────────────────────────────

function isNoise(email: { sender: string | null; body: string | null; subject: string | null; snippet: string | null }): boolean {
  const body = email.body ?? "";
  const sender = (email.sender ?? "").toLowerCase();
  const subject = email.subject ?? "";

  // Very short body (just whitespace/invisible chars)
  const cleanBody = body.replace(/[\s\u200B\u00AD\uFEFF]+/g, " ").trim();
  if (cleanBody.length < 30) return true;

  // Known noise senders
  if (NOISE_SENDERS.some(p => sender.includes(p))) return true;

  // Known spam/marketing domains
  if (NOISE_DOMAINS.some(d => sender.includes(d))) return true;

  // Auto-replies
  if (subject.toLowerCase().startsWith("respuesta automática") || subject.toLowerCase().startsWith("automatic reply") || subject.toLowerCase().startsWith("out of office")) return true;

  // Known noise body patterns
  if (NOISE_PATTERNS.some(p => p.test(cleanBody) || p.test(subject))) return true;

  return false;
}

// ── Process a batch of emails with Haiku ────────────────────────────────

interface BatchResult {
  entities: number;
  facts: number;
  relationships: number;
  actions: number;
  processedIds: number[];
}

async function processBatch(
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  emails: { id: number; sender: string | null; recipient: string | null; subject: string | null; body: string | null; snippet: string | null; email_date: string | null; sender_type: string | null; account: string | null; has_attachments?: boolean; attachments?: { filename: string; mimeType: string; size: number }[] | null }[]
): Promise<BatchResult> {
  // Format emails for Claude — including attachment context
  // 500 chars/email is enough context for extraction without bloating input
  const emailsText = emails.map((e, i) => {
    const body = sanitizeEmailForClaude(e.body ?? e.snippet ?? "", 500);
    let attachmentInfo = "";
    if (e.has_attachments && e.attachments?.length) {
      const atts = (e.attachments as { filename: string; mimeType: string; size: number }[])
        .filter(a => !a.mimeType.startsWith("image/") || a.size > 100000) // skip small images (logos/signatures)
        .map(a => {
          const kb = Math.round(a.size / 1024);
          return `${a.filename} (${a.mimeType}, ${kb}KB)`;
        });
      if (atts.length) attachmentInfo = `\nAdjuntos: ${atts.join(", ")}`;
    }
    return `--- EMAIL ${i + 1} ---\nDe: ${e.sender}\nPara: ${e.recipient}\nAsunto: ${e.subject}\nFecha: ${e.email_date}\nTipo: ${e.sender_type}${attachmentInfo}\nCuerpo:\n${body}`;
  }).join("\n\n");

  // System prompt is large + stable across calls → gets cached by Anthropic
  // (Haiku needs >2048 tokens, ~8000 chars, to activate prompt caching)
  // Cache reads cost 10% of normal input, so 346 calls/day amortize the cache write
  const SYSTEM_PROMPT = `Eres un extractor de inteligencia de negocio para Quimibond — fabricante textil mexicano con sede en Toluca (Estado de Mexico). Tu trabajo es extraer entidades, hechos verificables, relaciones y acciones pendientes de emails internos y externos.

## Contexto de negocio
- Quimibond vende productos quimicos y materiales para la industria textil
- Clientes: maquiladoras, marcas de ropa, fabricantes de automoviles (BMW, etc)
- Proveedores: empresas quimicas internacionales (Zwisstex, otros)
- Empleados internos tienen dominios @quimibond.com, @quimibond.com.mx
- La moneda default es MXN. Fechas en formato ISO (YYYY-MM-DD).

## Tipos de entidades
- **person**: individuos (clientes, proveedores, empleados, contactos)
- **company**: empresas (clientes corporativos, proveedores, competidores)
- **product**: SKUs, materias primas, productos terminados, formulaciones

## Tipos de facts
Solo hay 5 tipos validos. Si un hecho no encaja en uno de estos, NO lo extraigas — ignoralo.

- **commitment**: promesas (entregar, pagar, llamar, cotizar en X fecha)
- **complaint**: quejas, problemas, defectos, retrasos reportados
- **request**: solicitudes explicitas de info, cotizacion, muestra, reunion
- **price**: precios, descuentos, cotizaciones mencionadas
- **change**: cambios anunciados (precio, proveedor, persona de contacto, politica)

## Que NO extraer como fact (ruido que ya tenemos en otras tablas)
- NO extraigas confirmaciones de entrega, guias de envio, numeros de tracking — ya estan en odoo_deliveries.
- NO extraigas notificaciones de pagos/transferencias recibidas — ya estan en odoo_payments.
- NO extraigas envio/recepcion de facturas, CFDIs, ordenes de compra como documentos — ya estan en odoo_invoices/cfdi_documents.
- NO extraigas puestos, departamentos ni organigramas — ya estan en odoo_employees.
- NO extraigas metadata de stock, inventario en transito, material disponible — ya esta en odoo_products.
- NO extraigas textos de procedimientos, plantillas de correo, instrucciones genericas.
- NO extraigas pedidos personales (Amazon, Mercado Libre) ni entregas no relacionadas al negocio textil.
- NO extraigas "se envio", "se recibio", "se firmo" como facts — son ruido de audit trail.

Si despues de filtrar no queda nada util en el email, devuelve facts: [].

## Tipos de relaciones
- **works_at**: persona trabaja en empresa
- **buys_from**: empresa compra de otra empresa (cliente → proveedor)
- **sells_to**: inverso de buys_from
- **supplies**: entidad suministra producto/material
- **mentioned_with**: mencionados en mismo contexto sin relacion clara

## Tipos de action_items
- **call**: llamar por telefono
- **email**: responder o enviar email
- **follow_up**: dar seguimiento a tema abierto
- **review**: revisar documento/propuesta/calidad
- **other**: cualquier otra accion

## Prioridades de action_items
- **high**: urgente, deadline < 3 dias, o involucra > $100K MXN
- **medium**: deadline entre 3-7 dias, o impacto operativo
- **low**: informativo, sin deadline

## Adjuntos
Cuando veas ADJUNTOS listados en un email, ignora los documentos rutinarios (facturas, CFDIs, guias, recibos) — ya se procesan por su propio pipeline. Solo extrae facts de adjuntos si contienen informacion comercialmente relevante que no este en Odoo:
- Ordenes de compra con fechas/cantidades nuevas: fact tipo "commitment"
- Listas de precios o cotizaciones: fact tipo "price"
- Quejas o reclamos formales: fact tipo "complaint"
- Cambios anunciados en terminos, proveedores o personas: fact tipo "change"

## Formato de salida
Responde ESTRICTAMENTE con JSON valido siguiendo este schema:
{
  "entities": [
    {"name": "string", "type": "person|company|product", "email": "string o null"}
  ],
  "facts": [
    {"entity_name": "string", "type": "commitment|complaint|request|price|change", "text": "string conciso", "date": "YYYY-MM-DD o null", "confidence": 0.0-1.0}
  ],
  "relationships": [
    {"entity_a": "string", "entity_b": "string", "type": "works_at|buys_from|sells_to|supplies|mentioned_with", "context": "string corto"}
  ],
  "action_items": [
    {"assignee": "nombre o empresa", "description": "accion concreta", "type": "call|email|follow_up|review|other", "priority": "low|medium|high", "due_date": "YYYY-MM-DD o null", "related_to": "contacto o empresa relacionada"}
  ]
}

## Reglas
- NO inventes datos. Si no hay accion clara, devuelve action_items: [].
- Un fact por compromiso o informacion unica, no dupliques.
- Entidades con nombre < 2 caracteres se ignoran.
- Confidence debe reflejar certeza real (0.9+ solo si es explicito, 0.5-0.7 si es inferencia).
- NO incluyas comentarios, NO uses markdown code blocks, SOLO el JSON.`;

  const { result } = await callClaudeJSON<{
    entities?: { name: string; type: string; email?: string }[];
    facts?: { entity_name: string; type: string; text: string; date?: string; confidence?: number }[];
    relationships?: { entity_a: string; entity_b: string; type: string; context?: string }[];
    action_items?: { assignee: string; description: string; type: string; priority: string; due_date?: string; related_to?: string }[];
  }>(apiKey, {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000, // headroom for 5 emails of rich extraction
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Extrae inteligencia de estos ${emails.length} emails:\n\n${emailsText}`,
    }],
  }, "analyze-batch");

  // Save entities
  let entitiesSaved = 0;
  const entityMap: Record<string, number> = {};
  for (const ent of (result.entities ?? [])) {
    const canonical = String(ent.name ?? "").toLowerCase().trim();
    if (!canonical || canonical.length < 2) continue;
    const { data } = await supabase
      .from("entities")
      .upsert({ entity_type: ent.type ?? "person", name: ent.name, canonical_name: canonical, email: ent.email ?? null },
        { onConflict: "entity_type,canonical_name" })
      .select("id");
    if (data?.[0]?.id) { entityMap[String(ent.name)] = data[0].id; entitiesSaved++; }
  }

  // Save facts — only the 5 types actually consumed by directors.
  // `information` was removed (audit 2026-04-15): 59% of fact volume, 0% read
  // by any director. See src/app/api/agents/orchestrate/route.ts where facts
  // are queried with fact_type IN (complaint, commitment, request, price, change).
  const ALLOWED_FACT_TYPES = new Set(["commitment", "complaint", "request", "price", "change"]);
  let factsSaved = 0;
  let factsFiltered = 0;
  const facts: Record<string, unknown>[] = [];
  for (const f of (result.facts ?? [])) {
    if (!f.entity_name || !f.text) continue;
    const factType = String(f.type ?? "").toLowerCase();
    if (!ALLOWED_FACT_TYPES.has(factType)) {
      factsFiltered++;
      continue;
    }
    let entityId = entityMap[String(f.entity_name)];
    if (!entityId) {
      const { data } = await supabase.from("entities").select("id")
        .eq("canonical_name", String(f.entity_name).toLowerCase().trim()).limit(1);
      if (data?.[0]?.id) entityId = data[0].id;
    }
    if (!entityId) continue;
    facts.push({
      entity_id: entityId,
      fact_type: factType,
      fact_text: f.text,
      fact_hash: createHash("md5").update(`${entityId}|${factType}|${f.text}`).digest("hex"),
      confidence: f.confidence ?? 0.8,
      source_type: "email",
      source_account: emails[0]?.account ?? "unknown",
    });
  }
  if (factsFiltered > 0) {
    console.log(`[analyze-batch] filtered ${factsFiltered} non-consumed facts (information/other)`);
  }
  if (facts.length) {
    const { error } = await supabase.from("facts").upsert(facts, { onConflict: "fact_hash", ignoreDuplicates: true });
    if (!error) factsSaved = facts.length;
  }

  // Save relationships
  let relsSaved = 0;
  for (const rel of (result.relationships ?? [])) {
    if (!rel.entity_a || !rel.entity_b) continue;
    const aId = entityMap[String(rel.entity_a)];
    const bId = entityMap[String(rel.entity_b)];
    if (aId && bId) {
      await supabase.from("entity_relationships").upsert({
        entity_a_id: aId, entity_b_id: bId,
        relationship_type: rel.type ?? "mentioned_with",
        context: rel.context ?? null,
      }, { onConflict: "entity_a_id,entity_b_id,relationship_type" });
      relsSaved++;
    }
  }

  // Action items: only save HIGH priority with specific assignee and due date
  // (was saving everything → 1300+ garbage "review" items nobody did)
  const actionRows = (result.action_items ?? [])
    .filter((a: { description?: string; priority?: string; assignee?: string; due_date?: string }) =>
      a.description &&
      a.priority === "high" &&
      a.assignee &&
      a.due_date
    )
    .slice(0, 3) // max 3 actions per batch
    .map((a: { type?: string; description: string; priority?: string; assignee?: string; related_to?: string; due_date?: string }) => ({
      action_type: a.type ?? "other",
      description: a.description,
      priority: a.priority ?? "high",
      assignee_name: a.assignee ?? null,
      contact_name: a.related_to ?? null,
      due_date: a.due_date ?? null,
      state: "pending",
    }));
  let actionsSaved = 0;
  if (actionRows.length > 0) {
    await supabase.from("action_items").insert(actionRows);
    actionsSaved = actionRows.length;
  }

  return {
    entities: entitiesSaved,
    facts: factsSaved,
    relationships: relsSaved,
    actions: actionsSaved,
    processedIds: emails.map(e => e.id),
  };
}

// ── Mark emails as processed with error handling ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markProcessed(supabase: any, ids: number[]) {
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await supabase.from("emails").update({ kg_processed: true }).in("id", batch);
    if (error) console.error(`[analyze] markProcessed batch failed:`, error.message);
  }
}
