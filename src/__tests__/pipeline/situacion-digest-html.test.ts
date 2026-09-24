import { describe, it, expect } from "vitest";
import { renderSituacionDigestHtml, renderSituacionDigestText, type Cambios } from "../../../supabase/functions/_shared/situacion-digest-html";
import { mdToHtml, esc } from "../../../supabase/functions/_shared/email-html";
import { SYSTEM, entradaParaClaude } from "../../../supabase/functions/situacion-digest/prompt";

const item = (id: number, extra: Partial<Cambios["areas"][0]["nuevas"][0]> = {}) => ({
  id, titulo: `Cartera vencida · ACME ${id}`, senal: "cartera_vencida", tipo: "credito", contraparte: "ACME", severidad: 4, estado: "abierta", calidad: "viva",
  dias_abierta: 12, responsable: "Ana", delegada_a: null, delegacion_estado: null, recomendacion: "Cobrar F/1 <hoy>", ultimo_cambio: "empeoró: 5 → 7 documentos",
  valor_texto: "7 facturas", redactada: true, ...extra,
});
const cambios: Cambios = {
  desde: "2026-09-23T12:30:00Z", hasta: "2026-09-24T12:30:00Z",
  areas: [
    { area: "finanzas", abiertas: 40, nuevas: [item(1)], empeoradas: [item(2)], mejoradas: [], resueltas: [item(3, { estado: "resuelta" })], delegadas: [item(4, { estado: "delegada", delegada_a: "Luis", delegacion_estado: "creada" })], graves: [item(5, { redactada: false })] },
    { area: "comercial", abiertas: 3, nuevas: [], empeoradas: [], mejoradas: [item(6)], resueltas: [], delegadas: [], graves: [] },
  ],
  rezago: [{ ...item(7), area: "compras", dias_abierta: 80 }],
  ignoradas: 12, reglas_vigentes: 3, higiene: { zombie: 1500, dato_malo: 4 },
  salud: { odoo_push_edad_h: 0.7, bot_terminada_en: "2026-09-24T12:20:00Z", sin_datos: [] },
  totales: { nuevas: 1, empeoradas: 1, mejoradas: 1, resueltas: 1, delegadas: 1, graves: 1, abiertas: 43, rezago: 1 },
};

describe("situacion-digest-html", () => {
  it("imprime cada lista con título, contraparte, días, responsable y recomendación, escapando HTML", () => {
    const html = renderSituacionDigestHtml({ dateLabel: "miércoles 24 de septiembre de 2026", narrativaMd: "## Lo que decidiría hoy\n- Cobrar a **ACME**", cambios, esLunes: false });
    expect(html).toContain("Cartera vencida · ACME 1");
    expect(html).toContain("Cobrar F/1 &lt;hoy&gt;");
    expect(html).toContain("Luis");                       // delegada a
    expect(html).toContain("<strong>ACME</strong>");      // narrativa en HTML
    expect(html).toContain("12 ignoradas");
    expect(html).toContain("1,500");                      // higiene con separador de miles
    expect(html).not.toContain("Rezago");                 // solo lunes
    expect(html).toContain("sin redactar");               // graves sin redacción se marcan
  });
  it("los lunes agrega el bloque de rezago y el texto plano dice lo mismo", () => {
    const html = renderSituacionDigestHtml({ dateLabel: "lunes", narrativaMd: "", cambios, esLunes: true });
    expect(html).toContain("Rezago");
    expect(html).toContain("80 días");
    const txt = renderSituacionDigestText({ dateLabel: "lunes", narrativaMd: "", cambios, esLunes: true });
    expect(txt).toContain("Cartera vencida · ACME 1");
    expect(txt).toContain("REZAGO");                      // en texto plano los encabezados van en mayúsculas
    expect(txt).toContain("Cobrar F/1 <hoy>");   // texto plano: sin escapar
    expect(txt).not.toContain("&lt;");
  });
  it("un día sin cambios lo dice en una línea", () => {
    const vacio: Cambios = { ...cambios, areas: [], rezago: [], totales: { nuevas: 0, empeoradas: 0, mejoradas: 0, resueltas: 0, delegadas: 0, graves: 0, abiertas: 43, rezago: 0 } };
    const html = renderSituacionDigestHtml({ dateLabel: "x", narrativaMd: "", cambios: vacio, esLunes: false });
    expect(html).toContain("Sin cambios");
  });
  it("listas recortadas dicen 'n de total' y el push con estado distinto de success se avisa", () => {
    // La RPC corta cada lista a 25 filas y manda el conteo real en n_<lista>.
    const recortado: Cambios = {
      ...cambios,
      areas: [{ area: "comercial", abiertas: 300, nuevas: [], empeoradas: [item(8)], mejoradas: [], resueltas: [], delegadas: [], graves: [item(9)], n_empeoradas: 1, n_graves: 209 }],
      salud: { odoo_push_edad_h: 0.7, odoo_push_status: "error", bot_terminada_en: "2026-09-24T12:20:00Z", sin_datos: [] },
    };
    const html = renderSituacionDigestHtml({ dateLabel: "x", narrativaMd: "", cambios: recortado, esLunes: false });
    const txt = renderSituacionDigestText({ dateLabel: "x", narrativaMd: "", cambios: recortado, esLunes: false });
    expect(html).toContain("Graves que siguen abiertas (1 de 209)");
    expect(txt).toContain("Graves que siguen abiertas (1 de 209)");
    expect(html).toContain("Empeoraron (1)");             // n igual al largo: título normal
    expect(txt).not.toContain("Empeoraron (1 de");
    expect(html).toContain("último push: error");
    expect(txt).toContain("último push: error");
    // Sin n_<lista> ni estado del push (o success) no se agrega nada.
    const normal = renderSituacionDigestHtml({ dateLabel: "x", narrativaMd: "", cambios, esLunes: false });
    expect(normal).not.toContain(" de 209");
    expect(normal).not.toContain("último push");
    expect(renderSituacionDigestText({ dateLabel: "x", narrativaMd: "", cambios, esLunes: false })).not.toContain("último push");
  });
});

describe("email-html", () => {
  it("mdToHtml: encabezados, bullets, negritas y escape", () => {
    const html = mdToHtml("## Título\n- uno **fuerte** <b>\n- dos\n\nPárrafo");
    expect(html).toContain("<h2");
    expect(html).toContain("<li>uno <strong>fuerte</strong> &lt;b&gt;</li>");
    expect(html).toContain("<p");
    expect(esc('a<b>&"')).toBe("a&lt;b&gt;&amp;&quot;");
  });
});

describe("situacion-digest/prompt", () => {
  it("la entrada para Claude cabe en el presupuesto y conserva ids y títulos", () => {
    const grande: Cambios = { ...cambios, areas: cambios.areas.map((a) => ({ ...a, graves: Array.from({ length: 200 }, (_, i) => item(1000 + i, { recomendacion: "x".repeat(400) })) })) };
    const txt = entradaParaClaude(grande, 20_000);
    expect(txt.length).toBeLessThanOrEqual(20_500);
    expect(txt).toContain("Cartera vencida · ACME 1");
    expect(txt).toContain('"id":1');
    expect(SYSTEM.toLowerCase()).toContain("json");
    expect(SYSTEM).toContain("situacion_cambios");
  });
});
