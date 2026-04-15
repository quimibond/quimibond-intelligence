// Grounding validators — ejecutados antes del INSERT de cada insight para
// evitar alucinaciones que pasan el confidence threshold.

export interface InsightCandidate {
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  [k: string]: unknown;
}

/**
 * Un insight está "grounded" si menciona al menos un identificador HARD
 * (invoice/PO/delivery ref, product ref, MRP order, email address, o thread
 * subject con fecha) en su `evidence`, `description` o `title`.
 *
 * Reforzado en audit 2026-04-15 sprint 2: antes aceptabamos cualquier match de
 * `company_name` del contexto, lo que permitia que Claude generara insights
 * vagos del estilo "CLIENTE X tiene problemas" sin ninguna referencia
 * verificable. Ahora el match por company_name solo cuenta como tiebreaker
 * cuando el insight ya tiene una referencia numerica concreta (monto MXN,
 * porcentaje, o fecha especifica) — elimina ~15% de insights debiles.
 */
export function hasConcreteEvidence(
  insight: InsightCandidate,
  contextString: string
): boolean {
  const evidenceArr = Array.isArray(insight.evidence) ? insight.evidence : [];
  const description = typeof insight.description === "string" ? insight.description : "";
  const title = typeof insight.title === "string" ? insight.title : "";
  const haystack = [...evidenceArr.map(String), description, title].join(" ");

  if (!haystack.trim()) return false;

  // Evidence array debe existir (no solo tener company en title/description).
  // Un insight sin evidence es por definicion generico.
  if (evidenceArr.length === 0) return false;

  // ── HARD identifiers (cualquiera de estos basta) ──────────────────────
  // 1) Odoo document ref: INV/2026/01/0075, P00123, SO/2026/0001, TL/OUT/12781,
  //    OC-06993-26, WH/OUT/*, MO/*, etc. (2-4 letras + barra/guion + digitos)
  if (/[A-Z]{2,4}[/\-]\d+/.test(haystack)) return true;
  // 2) Short numeric doc (P00123, MO00456)
  if (/\b[A-Z]\d{5,}\b/.test(haystack)) return true;
  // 3) Product ref pattern (WM4032OW152, HI7536NT, XJ140Q25JNT165)
  if (/\b[A-Z]{2,5}\d{2,}[A-Z0-9./]{0,10}\b/.test(haystack)) return true;
  // 4) Email address (elimina placeholders genericos tipo "un cliente"):
  //    user@domain.tld with a non-trivial local part (3+ chars).
  if (/\b[a-zA-Z0-9._%+-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/.test(haystack)) return true;

  // ── SOFT identifier: company name + specific numeric/date ─────────────
  // Company name alone is too weak. Require it to be paired with a concrete
  // quantity signal: MXN/USD amount, percentage, day count, or explicit date.
  const companyNames = new Set<string>();
  const nameRegex = /"(?:name|company_name|canonical_name)":\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRegex.exec(contextString)) !== null) {
    const n = m[1].trim();
    if (n.length >= 4) companyNames.add(n);
  }
  const mentionsCompany = Array.from(companyNames).some(n => haystack.includes(n));
  if (!mentionsCompany) return false;

  // Quantity/date signals that upgrade a company mention to grounded.
  // A specific number paired with a countable noun (≥3 letters) is enough:
  // "4 facturas vencidas", "15 dias atraso", "$450K en cartera", "30%" all pass.
  // Bare mention of the company without any number does NOT.
  const hasMoneyAmount = /\$\s?\d{1,3}(?:[,.]\d{3})+|\$\s?\d+[KkMm]?\b/.test(haystack);
  const hasPercent = /\b\d+(?:[.,]\d+)?\s?%/.test(haystack);
  const hasSpecificDate = /\b\d{1,2}[-/\s](?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)/i.test(haystack)
    || /\b\d{4}-\d{2}-\d{2}\b/.test(haystack);
  // Count of things: "4 facturas", "15 dias", "30 ordenes" (digit + 3+ letter word)
  const hasCountedNoun = /\b\d+\s+[a-zA-Záéíóúñ]{3,}/i.test(haystack);

  return hasMoneyAmount || hasPercent || hasSpecificDate || hasCountedNoun;
}

const META_HALLUCINATION_PATTERNS: RegExp[] = [
  /sesi[oó]n(es)? del ceo/i,
  /sesi[oó]n(es)? de direcci[oó]n/i,
  /interacci[oó]n(es)? (entre|de|del) (director|agente)/i,
  /participaci[oó]n del (director|agente)/i,
  /gobernanza/i,
  /activar (al )?director/i,
  /forzar (la )?participaci[oó]n/i,
  /ausente en (sesiones|flujos|decisiones)/i,
  /\bkpi de participaci[oó]n\b/i,
  /\bno se activa\b/i,
  /trigger del director/i,
];

export function looksLikeMetaHallucination(insight: InsightCandidate): boolean {
  const text = [
    typeof insight.title === "string" ? insight.title : "",
    typeof insight.description === "string" ? insight.description : "",
  ].join(" ");
  return META_HALLUCINATION_PATTERNS.some(p => p.test(text));
}
