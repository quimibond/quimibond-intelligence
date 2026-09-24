/** Prompt de la narrativa del correo de situación (Opus). Solo resume el JSON de situacion_cambios; no inventa. */
import type { Cambios, CambiosFila, ListaKey } from "../_shared/situacion-digest-html.ts";

export const SYSTEM = `Eres el asistente ejecutivo del director general de Quimibond (textil, México). Recibes el JSON de situacion_cambios: lo que cambió en el mapa de situación en las últimas 24 horas (por área: nuevas, empeoradas, mejoradas, resueltas, delegadas y lo grave que sigue abierto), más rezago y salud.

Escribe en español, en markdown, máximo 180 palabras, SOLO esta sección:

## Lo que decidiría hoy
3 a 6 bullets. Cada bullet: una decisión concreta del director (delegar a alguien, llamar a un cliente, cerrar algo, pedir una limpieza), con el título de la situación tal cual viene, la contraparte, la cifra o los días, y a quién. Primero lo que empeoró y lo grave; luego lo nuevo. Si hay delegaciones en error o el push de Odoo lleva más de 3 h, dilo en el primer bullet.

Reglas: solo hechos del JSON, nada inventado; no repitas las listas (el correo ya las trae debajo); no uses JSON ni tablas; sin enlaces ni URLs; si no hubo cambios, un solo bullet que lo diga.`;

const LISTAS: readonly ListaKey[] = ["empeoradas", "nuevas", "graves", "delegadas", "mejoradas", "resueltas"];
/** Orden en que se sacrifican listas cuando ni con 2 filas por lista cabe el presupuesto. */
const PRESCINDIBLES: readonly ListaKey[] = ["resueltas", "mejoradas", "delegadas"];

const recorta = (x: CambiosFila, conDetalle: boolean) => ({
  id: x.id, titulo: x.titulo.slice(0, 120), contraparte: x.contraparte, severidad: x.severidad, dias: x.dias_abierta,
  responsable: x.responsable, delegada_a: x.delegada_a, delegacion_estado: x.delegacion_estado,
  recomendacion: x.recomendacion?.slice(0, 220),
  ...(conDetalle ? { cambio: x.ultimo_cambio?.slice(0, 120), valor: x.valor_texto?.slice(0, 120) } : {}),
});

interface Recorte { tope: number; omitidas: ListaKey[]; conDetalle: boolean; conRezago: boolean }

function armar(c: Cambios, r: Recorte): string {
  const areas = c.areas.map((a) => {
    const o: Record<string, unknown> = { area: a.area, abiertas: a.abiertas };
    for (const l of LISTAS) if (!r.omitidas.includes(l)) o[l] = (a[l] ?? []).slice(0, r.tope).map((x) => recorta(x, r.conDetalle));
    return o;
  });
  const rezago = r.conRezago ? (c.rezago ?? []).slice(0, Math.min(r.tope, 10)).map((x) => recorta(x, r.conDetalle)) : undefined;
  return JSON.stringify({ desde: c.desde, hasta: c.hasta, totales: c.totales, areas, rezago, ignoradas: c.ignoradas, higiene: c.higiene, salud: c.salud });
}

/**
 * JSON compacto para Claude con presupuesto de caracteres. Siempre devuelve JSON válido (nunca se corta a la mitad):
 * primero cada lista se recorta a los N de mayor severidad (25 → 12 → 6 → 3 → 2); si aún no cabe, se quitan
 * resueltas, mejoradas y delegadas, luego el detalle (cambio y valor) y por último el rezago. Si ni así cabe,
 * devuelve el JSON más chico posible aunque se pase un poco.
 */
export function entradaParaClaude(c: Cambios, presupuesto = 40_000): string {
  const r: Recorte = { tope: 25, omitidas: [], conDetalle: true, conRezago: true };
  let txt = armar(c, r);
  while (txt.length > presupuesto && r.tope > 2) { r.tope = Math.max(2, Math.floor(r.tope / 2)); txt = armar(c, r); }
  const pasos: (() => void)[] = [
    ...PRESCINDIBLES.map((l) => () => { r.omitidas.push(l); }),
    () => { r.conDetalle = false; },
    () => { r.conRezago = false; },
  ];
  for (const paso of pasos) { if (txt.length <= presupuesto) break; paso(); txt = armar(c, r); }
  return txt;
}
