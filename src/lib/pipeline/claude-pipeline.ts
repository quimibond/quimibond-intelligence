/**
 * Claude Pipeline Service — Analysis calls for the intelligence pipeline.
 * Port of qb19's claude_service.py analysis methods to TypeScript.
 */
import { callClaudeJSON } from "@/lib/claude";
import type { OdooContext } from "./odoo-context";

interface AccountAnalysis {
  summary: Record<string, unknown>;
  knowledge_graph: {
    entities: Record<string, unknown>[];
    facts: Record<string, unknown>[];
    action_items: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    person_profiles: Record<string, unknown>[];
  };
}

/**
 * Analyze a single account's emails — summary + KG in one Claude call.
 */
export async function analyzeAccountFull(
  apiKey: string,
  department: string,
  account: string,
  emailText: string,
  extCount: number,
  intCount: number
): Promise<AccountAnalysis> {
  const system =
    "Analista de inteligencia para Quimibond (textiles, México). " +
    "Retorna SOLO JSON válido. Tags [ODOO:] son datos del ERP.";

  const truncated = smartTruncate(emailText, 6000);

  const prompt =
    `${department} (${account}): ${extCount} ext + ${intCount} int emails.\n\n` +
    'JSON:\n' +
    '{"summary":{"summary_text":"resumen 2-3 oraciones",' +
    '"overall_sentiment":"positive|neutral|negative|mixed",' +
    '"sentiment_score":0.0,' +
    '"topics_detected":[{"topic":"str","status":"new|ongoing|resolved"}],' +
    '"risks_detected":[{"risk":"str","severity":"high|medium|low"}],' +
    '"waiting_response":[{"contact":"nombre","subject":"str","hours_waiting":0}],' +
    '"external_contacts":[{"name":"str","email":"str","company":"str",' +
    '"sentiment":"positive|neutral|negative","sentiment_score":0.0}]},' +
    '"knowledge_graph":{"entities":[{"name":"str",' +
    '"type":"person|company|product|machine|raw_material","email":"str or null"}],' +
    '"facts":[{"entity_name":"str",' +
    '"type":"commitment|statement|price|complaint|request|information|change",' +
    '"text":"str","date":"YYYY-MM-DD or null","confidence":0.8}],' +
    '"action_items":[{"assignee":"quien","related_to":"contacto",' +
    '"description":"accion","reason":"por que",' +
    '"type":"call|email|meeting|follow_up|send_quote|review|other",' +
    '"priority":"low|medium|high","due_date":"YYYY-MM-DD or null"}],' +
    '"relationships":[{"entity_a":"str","entity_b":"str",' +
    '"type":"works_at|buys_from|sells_to|supplies|mentioned_with","context":"str"}],' +
    '"person_profiles":[{"name":"str","email":"str or null",' +
    '"role":"str","decision_power":"high|medium|low",' +
    '"communication_style":"formal|informal","personality_notes":"str"}]}}\n' +
    'sentiment_score: -1 a 1. facts: solo explicito. Cruza [ODOO:] con emails.\n\n' +
    `EMAILS:\n${truncated}`;

  const { result } = await callClaudeJSON<Record<string, unknown>>(apiKey, {
    system,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  }, `analyze_${account}`);

  // Normalize structure
  let summary = (result.summary as Record<string, unknown>) ?? result;
  let kg = (result.knowledge_graph as AccountAnalysis["knowledge_graph"]) ?? null;

  if (!kg && "entities" in result) {
    kg = {
      entities: (result.entities as Record<string, unknown>[]) ?? [],
      facts: (result.facts as Record<string, unknown>[]) ?? [],
      action_items: (result.action_items as Record<string, unknown>[]) ?? [],
      relationships: (result.relationships as Record<string, unknown>[]) ?? [],
      person_profiles: (result.person_profiles as Record<string, unknown>[]) ?? [],
    };
    // Remove KG fields from summary
    delete summary.entities;
    delete summary.facts;
    delete summary.action_items;
    delete summary.relationships;
    delete summary.person_profiles;
  }

  summary.external_emails = extCount;
  summary.internal_emails = intCount;

  return {
    summary,
    knowledge_graph: kg ?? {
      entities: [], facts: [], action_items: [],
      relationships: [], person_profiles: [],
    },
  };
}

/**
 * Synthesize executive briefing HTML.
 */
export async function synthesizeBriefing(
  apiKey: string,
  dataPackage: string
): Promise<string> {
  const system =
    "Eres el Chief Intelligence Officer de Quimibond, una productora de " +
    "no tejidos y textiles en México. Produces un briefing diario para el " +
    "Director General (José Mizrahi).\n\n" +
    "FORMATO HTML con secciones: REQUIERE TU ATENCIÓN, SCORECARD, " +
    "TIEMPOS DE RESPUESTA, SEGUIMIENTO DE ACCIONES, ANÁLISIS POR ÁREA, " +
    "OPERACIONES, COMERCIAL Y PIPELINE, ACCOUNTABILITY, CLIENTES Y PROVEEDORES, " +
    "RIESGOS, TENDENCIAS, COMPETENCIA, ACCIONES PARA MAÑANA.\n\n" +
    "Sé brutalmente honesto. Sin filtros. Usa <h2>, <h3>, <p>, <ul>, <li>, " +
    "<strong>, <table>.";

  const response = await callClaudeJSON<{ html: string }>(apiKey, {
    system,
    max_tokens: 8000,
    messages: [{ role: "user", content: dataPackage }],
  }, "briefing").catch(async () => {
    // Briefing returns HTML, not JSON — use raw call
    const { callClaude } = await import("@/lib/claude");
    const res = await callClaude(apiKey, {
      system,
      max_tokens: 8000,
      messages: [{ role: "user", content: dataPackage }],
    }, "briefing");
    const data = await res.json();
    return { result: { html: data.content?.[0]?.text ?? "" } };
  });

  return response.result.html;
}

/**
 * Format emails with Odoo context and person profiles for Claude.
 */
export function formatEmailsForClaude(
  emails: { from_email: string; to: string; subject: string; date: string; sender_type: string; body?: string; snippet?: string }[],
  odooCtx: OdooContext,
  personProfiles: Record<string, Record<string, unknown>> = {},
  maxEmails = 10,
  maxBody = 400
): string {
  const lines: string[] = [];
  const selected = emails.slice(0, maxEmails);

  for (let i = 0; i < selected.length; i++) {
    const e = selected[i];
    lines.push(`--- EMAIL ${i + 1} ---`);
    lines.push(`De: ${e.from_email}`);
    lines.push(`Para: ${e.to}`);
    lines.push(`Asunto: ${e.subject}`);
    lines.push(`Fecha: ${e.date}`);
    lines.push(`Tipo: ${e.sender_type}`);

    // [ODOO:] business context
    const biz = odooCtx.business_summary[e.from_email.toLowerCase()];
    if (biz) {
      lines.push(`[ODOO: ${biz}]`);
    }

    // [PERSONA CONOCIDA:] profile
    const profile = personProfiles[e.from_email.toLowerCase()];
    if (profile) {
      const parts: string[] = [];
      if (profile.role) parts.push(`Rol: ${profile.role}`);
      if (profile.decision_power) parts.push(`Poder decisión: ${profile.decision_power}`);
      if (profile.communication_style) parts.push(`Estilo: ${profile.communication_style}`);
      if (profile.key_interests) {
        const interests = Array.isArray(profile.key_interests)
          ? profile.key_interests.slice(0, 5).join(", ")
          : String(profile.key_interests);
        parts.push(`Intereses: ${interests}`);
      }
      if (profile.negotiation_style) parts.push(`Negociación: ${profile.negotiation_style}`);
      if (profile.personality_notes) parts.push(`Notas: ${String(profile.personality_notes).slice(0, 100)}`);
      if (parts.length) lines.push(`[PERSONA CONOCIDA: ${parts.join(" | ")}]`);
    }

    const body = (e.body || e.snippet || "").slice(0, maxBody);
    lines.push(`Cuerpo:\n${body}`);
    lines.push("");
  }

  return lines.join("\n");
}

function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  if (cut > maxChars * 0.7) return text.slice(0, cut) + "\n[... truncado]";
  return text.slice(0, maxChars) + "\n[... truncado]";
}

export type { AccountAnalysis };
