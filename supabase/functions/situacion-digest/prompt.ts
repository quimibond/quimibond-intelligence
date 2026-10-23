/** Prompt de la narrativa del correo de situación (Opus). Solo resume el JSON de situacion_cambios; no inventa. */
import type { Cambios, CambiosFila, ListaKey } from "../_shared/situacion-digest-html.ts";

export const SYSTEM = `Eres el asesor del director general de Quimibond (fabricante textil de no tejidos, México). Cada mañana le dices en 30 segundos qué decidir hoy para proteger el dinero, los clientes y la operación.

Recibes un JSON con:
- "negocio": los montos del día que salen de Odoo (cartera vencida, cuentas por pagar vencidas, entregado sin facturar, ventas con margen negativo, clientes y productos que pierden), con las empresas que más pesan, y conteos de entregas vencidas, OPs atrasadas y reclamaciones.
- "areas", "rezago", "totales": lo que cambió en el mapa de situación (situacion_cambios) desde el último correo: nuevas, empeoradas, mejoradas, resueltas, delegadas y lo grave que sigue abierto.

Escribe en español, en markdown, máximo 200 palabras, SOLO esta sección:

## Lo que decidiría hoy
3 a 5 bullets, ordenados por impacto en pesos o en un cliente importante, no por severidad ni por antigüedad. Cada bullet empieza con la decisión en **negritas** (cobrar, frenar envíos, autorizar, llamar, cambiar a un responsable, renegociar, revisar un precio) y dice: con quién (empresa), cuánto (monto o días, tal cual viene) y quién lo ejecuta y para cuándo. Una línea por bullet.

Qué sí entra: dinero grande que se atora o se pierde (cartera y pagos vencidos de mayor monto, ventas o clientes con margen negativo, entregado sin facturar), clientes en riesgo (reclamaciones, entregas vencidas, clientes importantes sin respuesta), compromisos legales o de certificación con fecha, y algo que empeoró mucho desde ayer. Prefiere lo que solo el director puede destrabar; lo rutinario de un gerente no entra salvo que lleve semanas sin moverse.

Qué nunca entra: sistemas, automatizaciones, el push de Odoo, despliegues, tickets de TI, errores de registro o conciliación, calidad de los datos, "episodios", "cierres falsos" ni nada de cómo funciona el mapa. Si una situación es un problema de captura o de sistema, ignórala. Montos menores a $50,000 solo entran si el cliente es de los principales o el caso lleva más de 60 días.

Reglas: solo hechos del JSON, nada inventado; cifras redondeadas ($2.7 M, $650 mil); nombres de empresa como vienen; no repitas las listas (el correo ya las trae debajo); no uses JSON ni tablas; sin enlaces ni URLs; si no hubo nada relevante, un solo bullet que lo diga.`;

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

function armar(c: Cambios, r: Recorte, negocio?: unknown): string {
  const areas = c.areas.map((a) => {
    const o: Record<string, unknown> = { area: a.area, abiertas: a.abiertas };
    for (const l of LISTAS) if (!r.omitidas.includes(l)) o[l] = (a[l] ?? []).slice(0, r.tope).map((x) => recorta(x, r.conDetalle));
    return o;
  });
  const rezago = r.conRezago ? (c.rezago ?? []).slice(0, Math.min(r.tope, 10)).map((x) => recorta(x, r.conDetalle)) : undefined;
  // Sin salud ni higiene: son del funcionamiento del mapa, no de la empresa (el director no decide sobre eso).
  return JSON.stringify({ desde: c.desde, hasta: c.hasta, negocio, totales: c.totales, areas, rezago });
}

/**
 * JSON compacto para Claude con presupuesto de caracteres. Siempre devuelve JSON válido (nunca se corta a la mitad):
 * primero cada lista se recorta a los N de mayor severidad (25 → 12 → 6 → 3 → 2); si aún no cabe, se quitan
 * resueltas, mejoradas y delegadas, luego el detalle (cambio y valor) y por último el rezago. Si ni así cabe,
 * devuelve el JSON más chico posible aunque se pase un poco.
 */
export function entradaParaClaude(c: Cambios, presupuesto = 40_000, negocio?: unknown): string {
  const r: Recorte = { tope: 25, omitidas: [], conDetalle: true, conRezago: true };
  let txt = armar(c, r, negocio);
  while (txt.length > presupuesto && r.tope > 2) { r.tope = Math.max(2, Math.floor(r.tope / 2)); txt = armar(c, r, negocio); }
  const pasos: (() => void)[] = [
    ...PRESCINDIBLES.map((l) => () => { r.omitidas.push(l); }),
    () => { r.conDetalle = false; },
    () => { r.conRezago = false; },
  ];
  for (const paso of pasos) { if (txt.length <= presupuesto) break; paso(); txt = armar(c, r, negocio); }
  return txt;
}
