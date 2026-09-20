// Port a vitest del test Deno del plan (no hay deno en el CI; vitest sí).
import { describe, it, expect } from "vitest";
import { armarContexto, validarSalida, SYSTEM } from "../../../supabase/functions/situacion-consolidar/prompt";

const assert = (c: unknown, msg?: string) => expect(c, msg).toBeTruthy();
const assertEquals = (a: unknown, b: unknown) => expect(a).toEqual(b);

describe("situacion-consolidar/prompt", () => {
const ctx = {
  situacion: { id: 7, clave: "cartera_vencida|company:9", senal: "cartera_vencida", area: "finanzas", tipo: "credito", titulo: "Cartera vencida · ACME", estado: "empeoro", severidad: 3, calidad: "viva", dias_abierta: 12, dias_sin_cambio: 0, ultimo_cambio: "empeoró: 5 → 7 documentos", valor: 53000, valor_texto: "7 facturas", n_senales: 7, version: 3, ia_version: 2 },
  senal_config: { titulo: "Cartera vencida", descripcion: "Facturas vencidas por cliente", severidad_base: 3, severidad_max: 5 },
  senales: Array.from({ length: 50 }, (_, i) => ({ clave: `cartera_vencida:partner:${i}`, valor: i, valor_texto: "x".repeat(300), documentos: [{ modelo: "account.move", id: i, nombre: `F/${i}` }] })),
  contraparte: { empresa: { name: "ACME" }, memoria: { hechos: [{ hecho: "paga a 60 días" }], hilos: [] } },
  conversaciones: [{ tema: "Cobro", resumen: "y".repeat(5000), estado: "abierto" }],
  hermanas: [], posibles_duplicados: [{ id: 8, titulo: "Promesa de pago · ACME", similitud: 0.4 }], reglas: [], personas: [{ odoo_user_id: 2, name: "Ana", motivo: "dueño" }], historia: [],
};

it("armarContexto respeta el presupuesto y conserva lo esencial", () => {
  const txt = armarContexto(ctx as never, 6000);
  assert(txt.length <= 6200, `largo ${txt.length}`);
  assert(txt.includes("Cartera vencida · ACME"));
  assert(txt.includes("Posibles duplicados"));
  assert(txt.includes("Ana"));
});

it("validarSalida recorta severidad a la banda y limpia duplicados", () => {
  const out = validarSalida({ titulo: "T", resumen: "R", recomendacion: "Rec", severidad: 9, responsable_sugerido_user_id: "2", responsable_motivo: "m", estado: "empeoro",
    duplicados: [{ id: 8, decision: "fusionar", motivo: "misma cartera" }, { id: 7, decision: "fusionar", motivo: "yo misma" }, { id: 99, decision: "distinta" }], evento_historia: "e" },
    { base: 3, max: 5, id: 7, candidatos: [8, 99] });
  assertEquals(out.severidad, 5);
  assertEquals(out.responsable_sugerido_user_id, 2);
  assertEquals(out.duplicados, [{ id: 8, decision: "fusionar", motivo: "misma cartera" }]);
});

it("validarSalida rechaza salida sin título o resumen", () => {
  let err = "";
  try { validarSalida({ titulo: "", resumen: "" }, { base: 1, max: 5, id: 1, candidatos: [] }); } catch (e) { err = String(e); }
  assert(err.includes("titulo"));
});

it("el prompt del sistema fija el contrato", () => {
  for (const s of ["quimibond", "json", "severidad", "responsable", "duplicados", "nunca"]) assert(SYSTEM.toLowerCase().includes(s), s);
});
});
