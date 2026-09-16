/**
 * Limpieza determinística de correos (Memoria Fase 1).
 *
 * Dos funciones puras, sin IA:
 *  - htmlToText: HTML → texto plano conservando saltos de línea y decodificando
 *    entidades (el ingest legacy hacía un strip por regex que colapsaba todo en
 *    una sola línea y dejaba &nbsp; y &amp; sueltos).
 *  - stripQuotedText: deja SOLO el mensaje nuevo, quitando el hilo citado
 *    (Outlook "De:/Enviado:", Gmail "El ... escribió:", líneas con ">",
 *    separadores "____"), la firma (`-- `, "Enviado desde mi iPhone") y los
 *    banners corporativos ("CAUTION: EXTERNAL SENDER").
 *
 * body_clean = stripQuotedText(body_full). Es la base del chunking en Fase 2:
 * cada párrafo se indexa una sola vez aunque se cite en 20 respuestas.
 */

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  iquest: "¿",
  iexcl: "¡",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  euro: "€",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** HTML → texto plano con saltos de línea razonables. */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  // Bloques que nunca son contenido
  s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Saltos de línea estructurales
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Filas y items: solo el cierre produce salto (una línea por fila)
  s = s.replace(/<\/(tr|li)\s*>/gi, "\n");
  s = s.replace(/<\/t[dh]\s*>/gi, "\t");
  // Bloques: apertura y cierre producen salto (párrafos separados por línea en blanco)
  s = s.replace(/<\/(p|div|h[1-6]|blockquote|pre|table|ul|ol|section|article|header|footer)\s*>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|blockquote|pre|table|ul|ol|section|article|header|footer)\b[^>]*>/gi, "\n");
  s = s.replace(/<hr\s*\/?>/gi, "\n----\n");
  // Resto de etiquetas
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Normalizar espacios: no colapsar saltos de línea
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[ \u00a0]+/g, " ");
  s = s.replace(/\t+/g, "\t");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ── Recorte de citas y firma ──────────────────────────────────────────────

/** Una línea que abre un bloque citado: todo lo que sigue se descarta. */
const QUOTE_START_PATTERNS: RegExp[] = [
  // Gmail / Apple Mail: "El mié, 16 sept 2026 a las 9:59, Luis <x@y> escribió:"
  /^(On|El|Le|Am|Il)\s.{3,200}?(wrote|escribi[oó]|a écrit|schrieb|ha scritto)\s*:?\s*$/i,
  // "-----Original Message-----", "---- Mensaje original ----", "---------- Forwarded message ---------"
  /^-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado|Mensaje original de)\s*-{2,}/i,
  // Separador de Outlook
  /^_{8,}\s*$/,
  // Outlook: "From: X" cuando a continuación viene Sent/To (se valida en el loop)
  /^(From|De|Von|Da)\s*:\s*\S/i,
  // Yahoo / algunos clientes
  /^Begin forwarded message:/i,
  /^-{2,}\s*Mensaje reenviado por/i,
];

const OUTLOOK_FOLLOWUP = /^(Sent|Enviado|Enviado el|Date|Fecha|Gesendet|Inviato|To|Para|An|A|Cc|CC|Subject|Asunto|Betreff|Oggetto)\s*:/i;

/** Líneas que arrancan la firma: todo lo que sigue se descarta. */
const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/,
  /^(Enviado desde mi|Sent from my|Get Outlook for|Obtener Outlook para|Descarga Outlook para)\b/i,
  /^(Saludos|Saludos cordiales|Atentamente|Atte\.?|Cordialmente|Best regards|Kind regards|Regards|Thanks,?|Gracias,?|Thank you,?|Un saludo|Quedo atent[oa])\s*[,.!]?\s*$/i,
];

/** Ruido que se elimina línea por línea sin cortar. */
const NOISE_LINE_PATTERNS: RegExp[] = [
  /^\s*CAUTION\s*:\s*EXTERNAL SENDER/i,
  /^\s*(PRECAUCI[OÓ]N|ATENCI[OÓ]N|AVISO)\s*:\s*(este )?(correo|mensaje|remitente) externo/i,
  /^\s*This email originated from outside/i,
  /^\s*Este correo (electrónico )?proviene de (fuera|un remitente externo)/i,
  /^\s*CGBANNERINDICATOR\s*$/i,
  /^\s*\[cid:[^\]]*\]\s*$/i,
  /^\s*(website|blog|news|shop)(\s*\|\s*(website|blog|news|shop))+\s*$/i,
];

const INLINE_NOISE = /\[cid:[^\]]*\]/gi;

export interface StripResult {
  clean: string;
  /** Qué disparó el corte de cita/firma (para depurar reglas). */
  cutBy: string | null;
}

export function stripQuotedText(text: string): string {
  return stripQuotedTextDetailed(text).clean;
}

export function stripQuotedTextDetailed(text: string): StripResult {
  if (!text) return { clean: "", cutBy: null };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  let cutBy: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(INLINE_NOISE, "").trimEnd();
    const trimmed = line.trim();

    // Línea citada con ">" — se omite pero no corta (Gmail intercala respuestas inline)
    if (/^\s*>/.test(line)) continue;

    if (NOISE_LINE_PATTERNS.some((p) => p.test(trimmed))) continue;

    if (matchesQuoteStart(trimmed, lines, i)) {
      cutBy = "quote";
      break;
    }

    // "El ... escribió:" partido en dos líneas (clientes que envuelven a 76 cols)
    if (
      /^(On|El|Le|Am)\s.{3,120}$/i.test(trimmed) &&
      i + 1 < lines.length &&
      /^.{0,80}(wrote|escribi[oó]|a écrit|schrieb)\s*:?\s*$/i.test(lines[i + 1].trim())
    ) {
      cutBy = "quote";
      break;
    }

    // La firma solo cuenta si ya hay contenido antes: "Gracias." como único
    // mensaje es el mensaje, no una despedida.
    const hasContent = kept.some((k) => k.trim().length > 0);
    if (SIGNATURE_PATTERNS.some((p) => p.test(trimmed)) && (hasContent || /^--\s*$/.test(trimmed))) {
      cutBy = "signature";
      break;
    }

    kept.push(line);
  }

  let clean = kept.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Si el recorte dejó nada (p.ej. un forward puro), conservar el inicio del original
  if (!clean) {
    clean = text.replace(/\r\n?/g, "\n").trim().slice(0, 1500);
    cutBy = cutBy ? `${cutBy}:fallback` : null;
  }
  return { clean, cutBy };
}

function matchesQuoteStart(trimmed: string, lines: string[], i: number): boolean {
  for (const p of QUOTE_START_PATTERNS) {
    if (!p.test(trimmed)) continue;
    // "From:/De:" solo cuenta como cita si dentro de las 5 líneas siguientes
    // aparece Sent/Enviado/To/Para/Subject (bloque de encabezado Outlook).
    if (/^(From|De|Von|Da)\s*:/i.test(trimmed)) {
      const window = lines.slice(i + 1, i + 6).map((l) => l.trim());
      return window.some((l) => OUTLOOK_FOLLOWUP.test(l));
    }
    return true;
  }
  return false;
}

/** Texto colapsado a una línea y cortado, igual que el `body` legacy (compat). */
export function legacyBody(text: string, max = 5000): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
