/**
 * Prompt y contrato del bot de situaciones (spec §6.4). Puro: sin red, testeable.
 */
export interface Contexto {
  situacion: Record<string, unknown> & { id: number; titulo: string; senal: string; estado: string; severidad: number; version: number; ia_version: number };
  senal_config: { titulo: string; descripcion: string | null; severidad_base: number; severidad_max: number; umbrales?: unknown } | null;
  senales: Record<string, unknown>[];
  documentos?: unknown[];
  contraparte: { empresa?: Record<string, unknown>; memoria?: Record<string, unknown> | null; company_id?: number } | null;
  conversaciones: Record<string, unknown>[];
  hermanas: { id: number; titulo: string; senal: string; severidad: number; estado: string; dias_abierta: number }[];
  posibles_duplicados: { id: number; titulo: string; senal: string; similitud?: number; documentos_comunes?: number }[];
  reglas: Record<string, unknown>[];
  personas: { odoo_user_id: number; name: string; department?: string | null; motivo: string }[];
  historia: Record<string, unknown>[];
}

export interface Salida {
  titulo: string;
  resumen: string;
  recomendacion: string;
  severidad: number;
  responsable_sugerido_user_id: number | null;
  responsable_motivo: string | null;
  estado: "abierta" | "empeoro" | "mejoro";
  duplicados: { id: number; decision: "fusionar" | "distinta"; motivo: string }[];
  evento_historia: string;
}

export const SYSTEM = `Eres el analista de situación de Quimibond (textil, México). Hablas desde Quimibond, para el director general, que decide qué delega y a quién. Recibes UNA situación (señales determinísticas de Odoo o del correo, agrupadas por SQL) con su contexto: documentos, ficha de memoria de la contraparte, conversaciones resumidas, situaciones hermanas, posibles duplicados, reglas del director e historia.

Devuelve SOLO un objeto JSON (sin markdown) con este esquema exacto:
{
 "titulo": "una línea, ≤ 90 caracteres, concreta: qué y con quién (conserva el título actual si sigue siendo correcto)",
 "resumen": "un párrafo (3-6 frases): qué pasa, desde cuándo, con quién, cuánto, qué cambió. Cifras, fechas y nombres tal como vienen.",
 "recomendacion": "la acción concreta que harías: verbo + responsable + documento. Una o dos frases.",
 "severidad": entero dentro de la banda indicada, justificado por la regla de la señal y la magnitud,
 "responsable_sugerido_user_id": id de odoo_users de la lista de personas, o null,
 "responsable_motivo": "por qué esa persona (dueño del documento, buzón que atiende, etc.)",
 "estado": "abierta | empeoro | mejoro",
 "duplicados": [{"id": <id de posibles_duplicados>, "decision": "fusionar | distinta", "motivo": "una frase"}],
 "evento_historia": "una línea para la bitácora: qué cambió y por qué importa"
}

Reglas estrictas:
- Solo lo que está en el contexto. Nada inventado; si falta un dato, dilo o usa null.
- Una situación = una decisión posible del director. Si son dos decisiones, dilo en la recomendación, no inventes otra situación.
- La severidad NUNCA sale de la banda [severidad_base, severidad_max]; base = lo normal para esa señal; max = con agravantes (monto alto, reincidencia/episodio > 1, cliente estratégico, reclamación tensa, plazo legal).
- La recomendación nombra la acción, al responsable y el documento (número de factura, OP, pedido, hilo).
- "duplicados": fusionar solo si es EL MISMO asunto con la misma contraparte (p.ej. la promesa de pago del correo y la cartera vencida de ese cliente); si dudas, "distinta". Nunca te fusiones a ti misma.
- Respeta las reglas del director listadas (ignorar, severidad fija, responsable fijo).
- Español neutro, sin adjetivos de relleno, sin copiar correos completos ni firmas. No repitas el contexto: resume.`;

const J = (x: unknown, max: number) => {
  const s = JSON.stringify(x ?? null);
  return s.length > max ? s.slice(0, max - 3) + "…\"]" : s;
};

/** Arma el bloque de usuario con presupuesto de caracteres: lo esencial completo, lo largo recortado. */
export function armarContexto(ctx: Contexto, presupuesto = 16_000): string {
  const s = ctx.situacion;
  const cfg = ctx.senal_config;
  const partes: string[] = [];
  partes.push(`Hoy: ${new Date().toISOString().slice(0, 10)}`);
  partes.push(`Situación #${s.id} [${s.senal} · ${String(s.area)}/${String(s.tipo)}] estado=${s.estado} calidad=${String(s.calidad)} severidad_actual=${s.severidad} banda=[${cfg?.severidad_base ?? 1},${cfg?.severidad_max ?? 5}]`);
  partes.push(`Título actual: ${s.titulo}`);
  partes.push(`Señal: ${cfg?.titulo ?? s.senal} — ${cfg?.descripcion ?? ""}`);
  partes.push(`Días abierta: ${String(s.dias_abierta)}; sin cambio: ${String(s.dias_sin_cambio)}; último cambio: ${String(s.ultimo_cambio ?? "")}; valor: ${String(s.valor ?? "")} (${String(s.valor_texto ?? "")}); vence: ${String(s.vence ?? "")}`);
  if (s.resumen) partes.push(`Resumen anterior (v${s.ia_version}): ${String(s.resumen)}\nRecomendación anterior: ${String(s.recomendacion ?? "")}`);
  if (ctx.reglas?.length) partes.push(`Reglas del director: ${J(ctx.reglas, 800)}`);
  partes.push(`Personas candidatas (odoo_user_id · nombre · motivo): ${ctx.personas.map((p) => `${p.odoo_user_id} · ${p.name}${p.department ? " (" + p.department + ")" : ""} · ${p.motivo}`).join("; ") || "ninguna"}`);
  if (ctx.posibles_duplicados?.length) partes.push(`Posibles duplicados (id · título · señal · similitud · documentos comunes): ${ctx.posibles_duplicados.map((d) => `${d.id} · ${d.titulo} · ${d.senal} · ${d.similitud ?? "-"} · ${d.documentos_comunes ?? 0}`).join("; ")}`);
  if (ctx.hermanas?.length) partes.push(`Otras situaciones abiertas de la misma contraparte: ${ctx.hermanas.slice(0, 8).map((h) => `#${h.id} ${h.titulo} (sev ${h.severidad}, ${h.dias_abierta} d)`).join("; ")}`);
  if (ctx.historia?.length) partes.push(`Historia: ${J(ctx.historia.slice(-6), 900)}`);

  // Bloques largos, en orden de importancia, con lo que quede del presupuesto.
  const fijo = partes.join("\n").length;
  let resto = Math.max(presupuesto - fijo - 200, 1500);
  const largo: [string, unknown, number][] = [
    ["Señales (clave, valor, texto, vence, calidad, episodio, documentos)", ctx.senales.map((x) => ({ clave: x.clave, valor: x.valor, valor_texto: String(x.valor_texto ?? "").slice(0, 160), vence: x.vence, calidad: x.calidad, episodio: x.episodio, docs: Array.isArray(x.documentos) ? (x.documentos as unknown[]).slice(0, 5) : [] })).slice(0, 30), 0.45],
    ["Contraparte", ctx.contraparte ? { empresa: ctx.contraparte.empresa, memoria: ctx.contraparte.memoria ? { encargados: (ctx.contraparte.memoria as Record<string, unknown>).encargados, hechos: (ctx.contraparte.memoria as Record<string, unknown>).hechos, stats: (ctx.contraparte.memoria as Record<string, unknown>).stats } : null } : null, 0.25],
    ["Conversaciones ligadas (resúmenes)", ctx.conversaciones.map((c) => ({ ...c, resumen: String(c.resumen ?? "").slice(0, 700) })), 0.30],
  ];
  for (const [titulo, obj, frac] of largo) {
    if (obj == null || (Array.isArray(obj) && !obj.length)) continue;
    const cupo = Math.floor(resto * frac) + 200;
    const txt = J(obj, cupo);
    partes.push(`${titulo}: ${txt}`);
    resto -= txt.length;
  }
  return partes.join("\n\n");
}

/** Normaliza y valida la respuesta de Claude contra la banda y los duplicados ofrecidos. Lanza si no sirve. */
export function validarSalida(raw: Record<string, unknown>, opts: { base: number; max: number; id: number; candidatos: number[] }): Salida {
  const titulo = String(raw.titulo ?? "").trim().slice(0, 160);
  const resumen = String(raw.resumen ?? "").trim();
  if (!titulo || !resumen) throw new Error("salida sin titulo o resumen");
  const sevRaw = Number(raw.severidad);
  const severidad = Math.min(Math.max(Number.isFinite(sevRaw) ? Math.round(sevRaw) : opts.base, opts.base), opts.max);
  const uidRaw = raw.responsable_sugerido_user_id;
  const uid = uidRaw == null || uidRaw === "" ? null : Number(uidRaw);
  const estado = (["abierta", "empeoro", "mejoro"] as string[]).includes(String(raw.estado)) ? (raw.estado as Salida["estado"]) : "abierta";
  const duplicados = (Array.isArray(raw.duplicados) ? raw.duplicados : [])
    .map((d) => ({ id: Number((d as { id: unknown }).id), decision: (d as { decision: string }).decision === "fusionar" ? "fusionar" as const : "distinta" as const, motivo: String((d as { motivo?: unknown }).motivo ?? "").slice(0, 200) }))
    .filter((d) => d.decision === "fusionar" && d.id !== opts.id && opts.candidatos.includes(d.id));
  return {
    titulo, resumen, recomendacion: String(raw.recomendacion ?? "").trim(), severidad,
    responsable_sugerido_user_id: uid != null && Number.isFinite(uid) ? uid : null,
    responsable_motivo: raw.responsable_motivo ? String(raw.responsable_motivo).slice(0, 300) : null,
    estado, duplicados, evento_historia: String(raw.evento_historia ?? "redactada").slice(0, 300),
  };
}
