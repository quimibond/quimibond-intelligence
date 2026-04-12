// Grounding validators — ejecutados antes del INSERT de cada insight para
// evitar alucinaciones que pasan el confidence threshold.

export interface InsightCandidate {
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  [k: string]: unknown;
}

/**
 * Un insight está "grounded" si AL MENOS UN fragmento de su evidence o description
 * contiene una referencia literal a algo del contexto: invoice name (`INV/2026/...`),
 * product ref (`KF4032T11...`), o una company name presente en las secciones de datos.
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

  // 1) Invoice name pattern (INV/2026/01/0075, P00123, SO/2026/0001, TL/OUT/...)
  if (/[A-Z]{2,4}[/\d]{2,}\/\d+/i.test(haystack)) return true;
  if (/\b[A-Z]\d{5,}\b/.test(haystack)) return true;

  // 2) Product ref pattern (typical: 2-4 letters + digits + letters/digits, >=6 chars total)
  if (/\b[A-Z]{2,5}\d{2,}[A-Z0-9./]{0,10}\b/.test(haystack)) return true;

  // 3) Company name anchoring — extract candidate company names from the context
  //    (anything inside "name":"X" or "company_name":"X") and check if any appears in the insight.
  const companyNames = new Set<string>();
  const nameRegex = /"(?:name|company_name|canonical_name)":\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRegex.exec(contextString)) !== null) {
    const n = m[1].trim();
    if (n.length >= 4) companyNames.add(n);
  }
  for (const name of companyNames) {
    if (haystack.includes(name)) return true;
  }

  return false;
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
