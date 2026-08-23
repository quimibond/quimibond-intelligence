/**
 * Render HTML del "Resumen de correo" diario (email-digest).
 *
 * Convierte el markdown que genera Claude en un correo HTML apto para
 * clientes de email (Gmail, Outlook, Apple Mail): layout con tablas,
 * estilos inline, fuentes de sistema y máximo 600px de ancho. Además de
 * la narrativa, agrega tablas con los datos estructurados que ya consulta
 * el digest (pendientes con deadline, hilos sin respuesta y clientes
 * callados) para que el CEO tenga el detalle sin abrir el sistema.
 */

export interface DigestStats {
  correos_externos_24h: number;
  pendientes: number;
  sin_respuesta: number;
  clientes_callados?: number;
}

export interface PendingActionRow {
  tipo: string | null;
  descripcion: string | null;
  deadline: string | null;
  company_name: string | null;
  account: string | null;
}

export interface UnansweredThreadRow {
  subject: string | null;
  company_name: string | null;
  last_sender: string | null;
  account: string | null;
  hours_waiting: number | null;
}

export interface SilentCustomerRow {
  company_name: string | null;
  days_silent: number | null;
  emails_90d: number | null;
  lifetime_value: number | null;
}

export interface DigestEmailInput {
  dateLabel: string;
  contentMd: string;
  stats: DigestStats;
  pendientes: PendingActionRow[];
  hilosSinRespuesta: UnansweredThreadRow[];
  clientesCallados: SilentCustomerRow[];
  systemUrl: string;
}

// ── Paleta (neutra, consistente con el frontend) ─────────────────────────
const C = {
  bg: "#f1f3f6",
  card: "#ffffff",
  ink: "#111827",
  body: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  lineSoft: "#f3f4f6",
  accent: "#2563eb",
  dangerBg: "#fef2f2",
  dangerInk: "#b91c1c",
  warnBg: "#fffbeb",
  warnInk: "#b45309",
};

const FONT =
  "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** **negritas** y *cursivas* sobre texto ya escapado. */
function inlineMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong style=\"color:#111827\">$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

const SECTION_EMOJI: Record<string, string> = {
  "lo más importante": "⚡",
  "lo mas importante": "⚡",
  "por cliente": "🏢",
  "pendientes y silencios": "⏳",
};

function sectionHeading(title: string): string {
  const emoji = SECTION_EMOJI[title.trim().toLowerCase()];
  const label = emoji ? `${emoji}&nbsp; ${inlineMd(esc(title))}` : inlineMd(esc(title));
  return (
    `<h2 style="margin:28px 0 12px;font-family:${FONT};font-size:14px;` +
    `font-weight:700;letter-spacing:0.06em;text-transform:uppercase;` +
    `color:${C.ink};border-bottom:2px solid ${C.ink};padding-bottom:8px;">` +
    `${label}</h2>`
  );
}

/**
 * Markdown mínimo → HTML con estilos inline. Soporta lo que produce el
 * digest: encabezados ##/###, bullets -/*, negritas y párrafos.
 */
export function digestMarkdownToHtml(md: string): string {
  const out: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    out.push(
      `<ul style="margin:0 0 14px;padding:0 0 0 20px;">${listItems.join("")}</ul>`,
    );
    listItems = [];
  };

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushList();
      out.push(sectionHeading(h[2]));
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      listItems.push(
        `<li style="margin:0 0 8px;font-family:${FONT};font-size:14px;` +
          `line-height:1.6;color:${C.body};">${inlineMd(esc(li[1]))}</li>`,
      );
      continue;
    }
    flushList();
    out.push(
      `<p style="margin:0 0 12px;font-family:${FONT};font-size:14px;` +
        `line-height:1.6;color:${C.body};">${inlineMd(esc(line))}</p>`,
    );
  }
  flushList();
  return out.join("\n");
}

// ── Formateo de datos ────────────────────────────────────────────────────

function fmtMoney(n: number | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtHours(h: number | null): string {
  if (h == null || !isFinite(h)) return "—";
  if (h >= 48) return `${(h / 24).toFixed(1).replace(/\.0$/, "")} días`;
  return `${Math.round(h)} h`;
}

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function fmtDeadline(iso: string | null, todayIso: string): string {
  if (!iso) return `<span style="color:${C.faint};">sin fecha</span>`;
  const d = iso.slice(0, 10);
  const [, m, day] = d.split("-");
  const label = `${parseInt(day, 10)} ${MONTHS_ES[parseInt(m, 10) - 1] ?? m}`;
  if (d < todayIso) {
    return (
      `<span style="display:inline-block;padding:2px 8px;border-radius:10px;` +
      `background:${C.dangerBg};color:${C.dangerInk};font-weight:700;` +
      `white-space:nowrap;">${label} · vencido</span>`
    );
  }
  if (d === todayIso) {
    return (
      `<span style="display:inline-block;padding:2px 8px;border-radius:10px;` +
      `background:${C.warnBg};color:${C.warnInk};font-weight:700;` +
      `white-space:nowrap;">hoy</span>`
    );
  }
  return `<span style="white-space:nowrap;">${label}</span>`;
}

// ── Tablas ───────────────────────────────────────────────────────────────

const TH =
  `padding:8px 10px;font-family:${FONT};font-size:11px;font-weight:700;` +
  `letter-spacing:0.05em;text-transform:uppercase;color:${C.muted};` +
  `border-bottom:1px solid ${C.line};text-align:left;`;
const TD =
  `padding:9px 10px;font-family:${FONT};font-size:13px;line-height:1.45;` +
  `color:${C.body};border-bottom:1px solid ${C.lineSoft};vertical-align:top;`;

function dataTable(headers: string[], rows: string[][], rightCols: number[] = []): string {
  const head = headers
    .map((hd, i) => `<th style="${TH}${rightCols.includes(i) ? "text-align:right;" : ""}">${hd}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => `<td style="${TD}${rightCols.includes(i) ? "text-align:right;" : ""}">${cell}</td>`)
          .join("")}</tr>`,
    )
    .join("\n");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="border-collapse:collapse;margin:0 0 8px;">` +
    `<tr>${head}</tr>${body}</table>`
  );
}

function tableTitle(emoji: string, title: string, count: number): string {
  return (
    `<h3 style="margin:26px 0 10px;font-family:${FONT};font-size:14px;` +
    `font-weight:700;color:${C.ink};">${emoji}&nbsp; ${esc(title)}` +
    `<span style="font-weight:400;color:${C.faint};"> · ${count}</span></h3>`
  );
}

function pendingTable(rows: PendingActionRow[], todayIso: string): string {
  if (!rows.length) return "";
  const body = rows.map((r) => [
    `<strong style="color:${C.ink};">${esc(r.company_name || "—")}</strong>` +
      `<br/><span style="color:${C.muted};font-size:12px;">${esc(r.tipo || "")}</span>`,
    esc(r.descripcion || "—"),
    fmtDeadline(r.deadline, todayIso),
  ]);
  return (
    tableTitle("📋", "Pendientes con deadline", rows.length) +
    dataTable(["Cliente", "Pendiente", "Deadline"], body, [2])
  );
}

function unansweredTable(rows: UnansweredThreadRow[]): string {
  if (!rows.length) return "";
  const body = rows.map((r) => [
    `<strong style="color:${C.ink};">${esc(r.company_name || "—")}</strong>` +
      `<br/><span style="color:${C.muted};font-size:12px;">${esc(r.account || "")}</span>`,
    esc(r.subject || "—"),
    `<span style="color:${C.dangerInk};font-weight:700;white-space:nowrap;">${fmtHours(r.hours_waiting)}</span>`,
  ]);
  return (
    tableTitle("⏳", "Hilos sin respuesta", rows.length) +
    dataTable(["Cliente", "Asunto", "Esperando"], body, [2])
  );
}

function silentTable(rows: SilentCustomerRow[]): string {
  if (!rows.length) return "";
  const body = rows.map((r) => [
    `<strong style="color:${C.ink};">${esc(r.company_name || "—")}</strong>`,
    `<span style="white-space:nowrap;">${r.days_silent ?? "—"} días</span>`,
    `${r.emails_90d ?? "—"}`,
    `<span style="white-space:nowrap;">${fmtMoney(r.lifetime_value)}</span>`,
  ]);
  return (
    tableTitle("🔕", "Clientes callados", rows.length) +
    dataTable(["Cliente", "Silencio", "Correos 90d", "Valor"], body, [1, 2, 3])
  );
}

// ── Documento completo ───────────────────────────────────────────────────

function statCell(value: number, label: string, danger = false): string {
  return (
    `<td align="center" style="padding:14px 6px;">` +
    `<div style="font-family:${FONT};font-size:26px;font-weight:800;` +
    `color:${danger && value > 0 ? C.dangerInk : C.ink};line-height:1.1;">${value}</div>` +
    `<div style="font-family:${FONT};font-size:11px;letter-spacing:0.04em;` +
    `text-transform:uppercase;color:${C.muted};margin-top:4px;">${label}</div></td>`
  );
}

export function renderDigestEmailHtml(input: DigestEmailInput): string {
  const {
    dateLabel, contentMd, stats, pendientes,
    hilosSinRespuesta, clientesCallados, systemUrl,
  } = input;

  const todayIso = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Mexico_City",
  });

  const preheader =
    `${stats.correos_externos_24h} correos de clientes, ` +
    `${stats.pendientes} pendientes, ${stats.sin_respuesta} hilos sin respuesta.`;

  const statsRow =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>` +
    statCell(stats.correos_externos_24h, "Correos 24h") +
    statCell(stats.pendientes, "Pendientes") +
    statCell(stats.sin_respuesta, "Sin respuesta", true) +
    statCell(stats.clientes_callados ?? clientesCallados.length, "Callados", true) +
    `</tr></table>`;

  const detailTables = [
    pendingTable(pendientes, todayIso),
    unansweredTable(hilosSinRespuesta),
    silentTable(clientesCallados),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>Resumen de correo</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">

  <!-- Encabezado -->
  <tr><td style="background:${C.ink};border-radius:12px 12px 0 0;padding:26px 32px;">
    <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.faint};">Quimibond Intelligence</div>
    <div style="font-family:${FONT};font-size:23px;font-weight:800;color:#ffffff;margin-top:6px;">📬 Resumen de correo</div>
    <div style="font-family:${FONT};font-size:13px;color:${C.faint};margin-top:4px;text-transform:capitalize;">${esc(dateLabel)}</div>
  </td></tr>

  <!-- Métricas -->
  <tr><td style="background:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};padding:4px 16px;">
    ${statsRow}
  </td></tr>

  <!-- Narrativa -->
  <tr><td style="background:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:4px 32px 8px;">
    ${digestMarkdownToHtml(contentMd)}
  </td></tr>

  ${detailTables
    ? `<!-- Detalle -->
  <tr><td style="background:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:0 32px 8px;">
    ${detailTables}
  </td></tr>`
    : ""}

  <!-- CTA -->
  <tr><td align="center" style="background:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-radius:0 0 12px 12px;border-bottom:1px solid ${C.line};padding:26px 32px 30px;">
    <a href="${esc(systemUrl)}" style="display:inline-block;background:${C.accent};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:8px;">Ver en el sistema&nbsp;→</a>
  </td></tr>

  <!-- Pie -->
  <tr><td align="center" style="padding:18px 32px;">
    <div style="font-family:${FONT};font-size:12px;color:${C.faint};line-height:1.6;">Generado automáticamente por Quimibond Intelligence con el correo de las últimas 24 horas.</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
