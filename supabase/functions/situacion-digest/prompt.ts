/** Prompt de la narrativa del correo de situación (Opus). Solo resume el JSON de situacion_cambios; no inventa. */
import type { Cambios, CambiosItem } from "../_shared/situacion-digest-html.ts";

export const SYSTEM = `Eres el asistente ejecutivo del director general de Quimibond (textil, México). Recibes el JSON de situacion_cambios: lo que cambió en el mapa de situación en las últimas 24 horas (por área: nuevas, empeoradas, mejoradas, resueltas, delegadas y lo grave que sigue abierto), más rezago y salud.

Escribe en español, en markdown, máximo 180 palabras, SOLO esta sección:

## Lo que decidiría hoy
3 a 6 bullets. Cada bullet: una decisión concreta del director (delegar a alguien, llamar a un cliente, cerrar algo, pedir una limpieza), con el título de la situación tal cual viene, la contraparte, la cifra o los días, y a quién. Primero lo que empeoró y lo grave; luego lo nuevo. Si hay delegaciones en error o el push de Odoo lleva más de 3 h, dilo en el primer bullet.

Reglas: solo hechos del JSON, nada inventado; no repitas las listas (el correo ya las trae debajo); no uses JSON ni tablas; si no hubo cambios, un solo bullet que lo diga.`;

const recorta = (x: CambiosItem) => ({ id: x.id, titulo: x.titulo, contraparte: x.contraparte, severidad: x.severidad, dias: x.dias_abierta, responsable: x.responsable, delegada_a: x.delegada_a, delegacion_estado: x.delegacion_estado, cambio: x.ultimo_cambio?.slice(0, 120), recomendacion: x.recomendacion?.slice(0, 220), valor: x.valor_texto?.slice(0, 120) });

/** JSON compacto para Claude con presupuesto de caracteres: cada lista se recorta a los N de mayor severidad hasta caber. */
export function entradaParaClaude(c: Cambios, presupuesto = 40_000): string {
  const listas = ["empeoradas", "nuevas", "graves", "delegadas", "mejoradas", "resueltas"] as const;
  let tope = 25;
  for (;;) {
    const areas = c.areas.map((a) => {
      const o: Record<string, unknown> = { area: a.area, abiertas: a.abiertas };
      for (const l of listas) o[l] = a[l].slice(0, tope).map(recorta);
      return o;
    });
    const txt = JSON.stringify({ desde: c.desde, hasta: c.hasta, totales: c.totales, areas, rezago: c.rezago.slice(0, Math.min(tope, 10)).map(recorta), ignoradas: c.ignoradas, higiene: c.higiene, salud: c.salud });
    if (txt.length <= presupuesto || tope <= 2) return txt.slice(0, presupuesto);
    tope = Math.max(2, Math.floor(tope / 2));
  }
}
