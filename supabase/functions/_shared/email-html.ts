/**
 * Helpers HTML para correos (Gmail, Outlook, Apple Mail): escape, markdown mínimo
 * (##, -, **, párrafos) y el layout de 600 px con estilos inline. Puro: sin Deno.
 */
export const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const C = {
  bg: "#f1f3f6", card: "#ffffff", ink: "#111827", body: "#374151", muted: "#6b7280", faint: "#9ca3af",
  line: "#e5e7eb", lineSoft: "#f3f4f6", accent: "#2563eb", dangerBg: "#fef2f2", dangerInk: "#b91c1c", warnBg: "#fffbeb", warnInk: "#b45309",
  okBg: "#ecfdf5", okInk: "#047857",
};

export function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Negritas e itálicas dentro de una línea ya escapada. */
export function inlineMd(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/** Markdown mínimo → HTML de correo: `## `, `### `, `- ` y párrafos. Todo lo demás se trata como texto. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let enLista = false;
  const cerrar = () => { if (enLista) { out.push("</ul>"); enLista = false; } };
  for (const raw of (md ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { cerrar(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      cerrar();
      const tag = h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3";
      const size = tag === "h1" ? 20 : tag === "h2" ? 16 : 14;
      out.push(`<${tag} style="margin:18px 0 8px;font:600 ${size}px/1.3 ${FONT};color:${C.ink}">${inlineMd(h[2])}</${tag}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!enLista) { out.push(`<ul style="margin:6px 0 10px 20px;padding:0;font:14px/1.5 ${FONT};color:${C.body}">`); enLista = true; }
      out.push(`<li>${inlineMd(li[1])}</li>`);
      continue;
    }
    cerrar();
    out.push(`<p style="margin:6px 0;font:14px/1.5 ${FONT};color:${C.body}">${inlineMd(line)}</p>`);
  }
  cerrar();
  return out.join("\n");
}

/** Marco del correo: fondo gris, tarjeta blanca de 600 px, pie. */
export function layout(title: string, bodyHtml: string, footerHtml = ""): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.card};border-radius:10px;border:1px solid ${C.line}">
<tr><td style="padding:24px 28px">${bodyHtml}</td></tr>
${footerHtml ? `<tr><td style="padding:14px 28px;border-top:1px solid ${C.lineSoft};font:12px/1.5 ${FONT};color:${C.faint}">${footerHtml}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

export function fmtInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}
