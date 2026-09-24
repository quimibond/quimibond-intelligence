/**
 * Render del correo diario "Situación" a partir del JSON de situacion_cambios (única fuente,
 * spec §7.2) y la narrativa de Claude. Determinístico: lo que sale aquí es lo que devuelve la RPC.
 */
import { C, FONT, esc, fmtInt, layout, mdToHtml } from "./email-html.ts";

export interface CambiosItem {
  id: number; titulo: string; senal?: string; tipo?: string; contraparte?: string | null; severidad: number; estado: string; calidad?: string;
  dias_abierta: number; responsable?: string | null; delegada_a?: string | null; delegacion_estado?: string | null;
  recomendacion?: string | null; ultimo_cambio?: string | null; valor_texto?: string | null;
  /** Solo `false` significa "sin redactar"; las filas de rezago no traen el campo. */
  redactada?: boolean;
}
/** Lo mínimo que necesita una fila del correo; las listas por área traen `CambiosItem` completo y el rezago solo esto. */
export type CambiosFila = Pick<CambiosItem, "id" | "titulo" | "severidad" | "dias_abierta"> & Partial<CambiosItem>;
/** Fila de rezago tal como la arma la RPC (sin redactada, valor_texto ni delegación). */
export type RezagoItem = Pick<CambiosItem, "id" | "titulo" | "contraparte" | "severidad" | "dias_abierta" | "responsable" | "recomendacion" | "ultimo_cambio"> & { area: string };
/** Las listas de un área. La RPC las corta a 25 filas y manda el conteo real en `n_<lista>`. */
export type ListaKey = "nuevas" | "empeoradas" | "mejoradas" | "resueltas" | "delegadas" | "graves";
export interface CambiosArea {
  area: string; abiertas: number;
  nuevas: CambiosItem[]; empeoradas: CambiosItem[]; mejoradas: CambiosItem[]; resueltas: CambiosItem[]; delegadas: CambiosItem[]; graves: CambiosItem[];
  n_nuevas?: number; n_empeoradas?: number; n_mejoradas?: number; n_resueltas?: number; n_delegadas?: number; n_graves?: number;
}
export interface Cambios {
  desde: string; hasta: string; areas: CambiosArea[]; rezago: RezagoItem[];
  ignoradas: number; reglas_vigentes: number; higiene: { zombie: number; dato_malo: number };
  salud: { odoo_push_edad_h: number | null; odoo_push_status?: string | null; bot_terminada_en: string | null; sin_datos: string[] };
  totales: Record<string, number>;
}
export interface DigestInput { dateLabel: string; narrativaMd: string; cambios: Cambios; esLunes: boolean }

const AREAS: Record<string, string> = { finanzas: "Finanzas", comercial: "Comercial", operaciones: "Operaciones", compras: "Compras", calidad_sgi: "Calidad / SGI", rh: "RH", sistemas: "Sistemas", direccion: "Dirección" };
const LISTAS: [ListaKey, string][] = [["empeoradas", "Empeoraron"], ["nuevas", "Nuevas"], ["graves", "Graves que siguen abiertas"], ["delegadas", "Delegadas"], ["mejoradas", "Mejoraron"], ["resueltas", "Resueltas"]];
const BOT_MAX_H = 3;

const sevColor = (s: number) => (s >= 5 ? C.dangerInk : s === 4 ? C.warnInk : C.muted);
/** Sin cambios = ninguna lista de ningún área trae filas (de las listas, no de `totales`: HTML y texto no pueden discrepar). */
const sinCambios = (c: Cambios) => (c.areas ?? []).every((a) => LISTAS.every(([k]) => !a[k]?.length));
const nombreArea = (area: string) => AREAS[area] ?? area;
/** "2026-09-23T12:30:00+00:00" → "2026-09-23 12:30 UTC". */
const fmtVentana = (iso: string) => `${String(iso ?? "").slice(0, 16).replace("T", " ")} UTC`;

/** "Graves que siguen abiertas (25 de 209)" cuando la RPC recortó la lista; si no, solo el título (con el largo en HTML). */
function tituloLista(a: CambiosArea, k: ListaKey, titulo: string, conLargo: boolean): string {
  const n = a[k].length;
  const total = a[`n_${k}`];
  if (total != null && total > n) return `${titulo} (${fmtInt(n)} de ${fmtInt(total)})`;
  return conLargo ? `${titulo} (${fmtInt(n)})` : titulo;
}

/** Horas entre `hasta` (el now() de la RPC) y un instante; null si alguno no es fecha. */
function horasDesde(iso: string | null | undefined, hasta: string): number | null {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return null;
  const ref = Date.parse(hasta ?? "");
  return Math.round(((Number.isNaN(ref) ? Date.now() : ref) - t) / 36e4) / 10;
}

/** Salud del mapa: una línea con las alertas (push, señales sin datos, bot, estado del push) o "en orden". */
function saludTexto(c: Cambios): { texto: string; alerta: boolean } {
  const salud = c.salud ?? { odoo_push_edad_h: null, bot_terminada_en: null, sin_datos: [] };
  const partes: string[] = [];
  if (salud.odoo_push_edad_h == null || salud.odoo_push_edad_h > 3) partes.push(`push de Odoo ${salud.odoo_push_edad_h == null ? "sin registro" : `hace ${salud.odoo_push_edad_h} h`}`);
  if (salud.sin_datos?.length) partes.push(`${salud.sin_datos.length} señal(es) sin datos: ${salud.sin_datos.slice(0, 6).join(", ")}`);
  const botH = horasDesde(salud.bot_terminada_en, c.hasta);
  if (botH == null || botH > BOT_MAX_H) partes.push(`bot sin corrida terminada${botH == null ? "" : ` hace ${botH.toFixed(1)} h`}`);
  if (salud.odoo_push_status && salud.odoo_push_status !== "success") partes.push(`último push: ${salud.odoo_push_status}`);
  return { texto: `Salud del mapa: ${partes.length ? partes.join(" · ") : "en orden"}`, alerta: partes.length > 0 };
}

/** Meta de una fila: contraparte · días · a quién (delegada, con su estado si no es "creada", o responsable). Texto plano, sin escapar. */
function metaFila(x: CambiosFila): string[] {
  const quien = x.delegada_a
    ? `delegada a ${x.delegada_a}${x.delegacion_estado && x.delegacion_estado !== "creada" ? ` (${x.delegacion_estado})` : ""}`
    : x.responsable ? `→ ${x.responsable}` : null;
  return [x.contraparte, `${x.dias_abierta} días`, quien].filter((s): s is string => Boolean(s));
}

function linea(x: CambiosFila): string {
  const meta = metaFila(x).map(esc).join(" · ");
  const sinRedactar = x.redactada === false;
  const rec = sinRedactar
    ? `<div style="color:${C.faint};margin-top:2px"><em>sin redactar aún</em>${x.valor_texto ? ` · ${esc(x.valor_texto)}` : ""}</div>`
    : x.recomendacion ? `<div style="color:${C.body};margin-top:2px">${esc(x.recomendacion)}</div>` : "";
  return `<tr><td style="padding:6px 0;border-bottom:1px solid ${C.lineSoft};font:13px/1.45 ${FONT};color:${C.ink}">
    <span style="display:inline-block;min-width:18px;font-weight:700;color:${sevColor(x.severidad)}">${x.severidad}</span> <strong>${esc(x.titulo)}</strong>
    <div style="color:${C.muted};font-size:12px">${meta}${x.ultimo_cambio ? ` · ${esc(x.ultimo_cambio)}` : ""}</div>${rec}</td></tr>`;
}

function bloqueArea(a: CambiosArea): string {
  const partes = LISTAS.filter(([k]) => a[k]?.length).map(([k, titulo]) =>
    `<div style="margin:10px 0 2px;font:600 12px/1.3 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.04em">${esc(tituloLista(a, k, titulo, true))}</div>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${a[k].map(linea).join("")}</table>`);
  if (!partes.length) return "";
  return `<h2 style="margin:22px 0 4px;font:600 16px/1.3 ${FONT};color:${C.ink}">${esc(nombreArea(a.area))} <span style="font-weight:400;color:${C.faint};font-size:13px">· ${fmtInt(a.abiertas)} abiertas</span></h2>${partes.join("")}`;
}

function stat(n: number, label: string, tono: "danger" | "warn" | "ok" | "plain" = "plain"): string {
  const ink = tono === "danger" ? C.dangerInk : tono === "warn" ? C.warnInk : tono === "ok" ? C.okInk : C.ink;
  return `<td align="center" style="padding:8px 4px"><div style="font:700 20px/1 ${FONT};color:${ink}">${fmtInt(n)}</div><div style="font:11px/1.3 ${FONT};color:${C.muted};margin-top:3px">${esc(label)}</div></td>`;
}

export function renderSituacionDigestHtml(input: DigestInput): string {
  const { cambios: c, esLunes } = input;
  const t = c.totales ?? {};
  const head = `<div style="font:12px/1.3 ${FONT};color:${C.faint};text-transform:uppercase;letter-spacing:.06em">Situación de la empresa</div>
    <h1 style="margin:4px 0 14px;font:700 22px/1.25 ${FONT};color:${C.ink}">${esc(input.dateLabel)}</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.lineSoft};border-radius:8px"><tr>
      ${stat(t.empeoradas ?? 0, "empeoraron", "danger")}${stat(t.nuevas ?? 0, "nuevas", "warn")}${stat(t.graves ?? 0, "graves abiertas", "warn")}${stat(t.delegadas ?? 0, "delegadas")}${stat(t.resueltas ?? 0, "resueltas", "ok")}${stat(t.abiertas ?? 0, "abiertas")}
    </tr></table>`;
  const narrativa = input.narrativaMd?.trim() ? `<div style="margin-top:16px">${mdToHtml(input.narrativaMd)}</div>` : "";
  const cuerpo = sinCambios(c)
    ? `<p style="margin:18px 0;font:14px/1.5 ${FONT};color:${C.body}">Sin cambios desde el último correo. ${fmtInt(t.abiertas ?? 0)} situaciones siguen abiertas.</p>`
    : c.areas.map(bloqueArea).join("");
  const rezago = esLunes && c.rezago?.length
    ? `<h2 style="margin:22px 0 4px;font:600 16px/1.3 ${FONT};color:${C.ink}">Rezago <span style="font-weight:400;color:${C.faint};font-size:13px">· sin cambio en más de 30 días</span></h2>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${c.rezago.map((x) => linea({ ...x, titulo: `${nombreArea(x.area)}: ${x.titulo}` })).join("")}</table>`
    : "";
  const salud = saludTexto(c);
  const pie = `${fmtInt(c.ignoradas)} ignoradas por tus reglas (${fmtInt(c.reglas_vigentes)} reglas) · higiene: ${fmtInt(c.higiene?.zombie)} zombis, ${fmtInt(c.higiene?.dato_malo)} datos malos` +
    (salud.alerta ? `<br><span style="color:${C.dangerInk}">${esc(salud.texto)}</span>` : `<br>${esc(salud.texto)}`) +
    `<br>Ventana: ${esc(fmtVentana(c.desde))} → ${esc(fmtVentana(c.hasta))}. Detalle por MCP: <code>select situacion_contexto(&lt;id&gt;)</code>.`;
  return layout(`Situación — ${input.dateLabel}`, head + narrativa + cuerpo + rezago, pie);
}

/** Versión texto plano (alternativa MIME y lo que se guarda). Dice lo mismo, sin HTML. */
export function renderSituacionDigestText(input: DigestInput): string {
  const { cambios: c, esLunes } = input;
  const t = c.totales ?? {};
  const out: string[] = [`SITUACIÓN — ${input.dateLabel}`, `${t.empeoradas ?? 0} empeoraron · ${t.nuevas ?? 0} nuevas · ${t.graves ?? 0} graves abiertas · ${t.delegadas ?? 0} delegadas · ${t.resueltas ?? 0} resueltas · ${t.abiertas ?? 0} abiertas`, ""];
  if (input.narrativaMd?.trim()) out.push(input.narrativaMd.trim(), "");
  const fila = (x: CambiosFila) => {
    const sinRedactar = x.redactada === false;
    return `  [${x.severidad}] ${x.titulo} — ${metaFila(x).join(" · ")}` +
      (sinRedactar ? `\n      (sin redactar aún${x.valor_texto ? `: ${x.valor_texto}` : ""})` : x.recomendacion ? `\n      ${x.recomendacion}` : "");
  };
  if (sinCambios(c)) {
    out.push(`Sin cambios desde el último correo. ${t.abiertas ?? 0} situaciones siguen abiertas.`, "");
  } else {
    for (const a of c.areas) {
      const partes = LISTAS.filter(([k]) => a[k]?.length);
      if (!partes.length) continue;
      out.push(`${nombreArea(a.area).toUpperCase()} · ${a.abiertas} abiertas`);
      for (const [k, titulo] of partes) { out.push(`  ${tituloLista(a, k, titulo, false)}:`); for (const x of a[k]) out.push(fila(x)); }
      out.push("");
    }
  }
  if (esLunes && c.rezago?.length) { out.push("REZAGO (sin cambio en más de 30 días)"); for (const x of c.rezago) out.push(fila({ ...x, titulo: `${nombreArea(x.area)}: ${x.titulo}` })); out.push(""); }
  out.push(`${c.ignoradas} ignoradas por tus reglas (${c.reglas_vigentes} reglas) · higiene: ${c.higiene?.zombie ?? 0} zombis, ${c.higiene?.dato_malo ?? 0} datos malos`);
  out.push(saludTexto(c).texto);
  out.push(`Ventana: ${fmtVentana(c.desde)} → ${fmtVentana(c.hasta)}`);
  return out.join("\n");
}
