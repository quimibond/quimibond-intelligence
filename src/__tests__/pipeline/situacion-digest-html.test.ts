import { describe, it, expect } from "vitest";
import { renderSituacionDigestHtml, renderSituacionDigestText, type Cambios, type RezagoItem } from "../../../supabase/functions/_shared/situacion-digest-html";
import { mdToHtml, inlineMd, esc, fmtInt } from "../../../supabase/functions/_shared/email-html";
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
const render = (c: Cambios, esLunes = false) => ({
  html: renderSituacionDigestHtml({ dateLabel: "x", narrativaMd: "", cambios: c, esLunes }),
  txt: renderSituacionDigestText({ dateLabel: "x", narrativaMd: "", cambios: c, esLunes }),
});

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
    expect(html).toContain("Salud del mapa: en orden");
    expect(html).toContain("2026-09-23 12:30 UTC → 2026-09-24 12:30 UTC");
  });
  it("los lunes agrega el bloque de rezago y el texto plano dice lo mismo", () => {
    const { html, txt } = render(cambios, true);
    expect(html).toContain("Rezago");
    expect(html).toContain("80 días");
    expect(txt).toContain("Cartera vencida · ACME 1");
    expect(txt).toContain("REZAGO");                      // en texto plano los encabezados van en mayúsculas
    expect(txt).toContain("Cobrar F/1 <hoy>");   // texto plano: sin escapar
    expect(txt).not.toContain("&lt;");
    expect(txt).toContain("Salud del mapa: en orden");
    expect(txt).toContain("Ventana: 2026-09-23 12:30 UTC → 2026-09-24 12:30 UTC");
  });
  it("una fila de rezago con la forma exacta de la RPC (sin redactada) trae su recomendación y no dice 'sin redactar'", () => {
    const rpc: RezagoItem = { id: 70, area: "compras", titulo: "OC sin confirmar · Textil Sur", contraparte: "Textil Sur", severidad: 3, dias_abierta: 45, responsable: "Ana", recomendacion: "Llamar al proveedor", ultimo_cambio: null };
    const { html, txt } = render({ ...cambios, rezago: [rpc] }, true);
    expect(html).toContain("Compras: OC sin confirmar · Textil Sur");
    expect(html).toContain("Llamar al proveedor");
    expect(txt).toContain("Llamar al proveedor");
    // La única "sin redactar" es la grave de finanzas (redactada: false), no el rezago.
    expect(html.split("sin redactar").length - 1).toBe(1);
    expect(txt.split("sin redactar").length - 1).toBe(1);
  });
  it("un día sin cambios lo dice en una línea, en HTML y en texto", () => {
    const vacio: Cambios = { ...cambios, areas: [], rezago: [], totales: { nuevas: 0, empeoradas: 0, mejoradas: 0, resueltas: 0, delegadas: 0, graves: 0, abiertas: 43, rezago: 0 } };
    const { html, txt } = render(vacio);
    expect(html).toContain("Sin cambios");
    expect(txt).toContain("Sin cambios en las últimas 24 horas. 43 situaciones siguen abiertas.");
    // Sin cambios se decide por las listas, no por totales: un área con listas vacías (aunque traiga n_*) no pinta bloque.
    const soloConteos: Cambios = { ...cambios, areas: [{ area: "sistemas", abiertas: 9, nuevas: [], empeoradas: [], mejoradas: [], resueltas: [], delegadas: [], graves: [], n_graves: 9 }], rezago: [] };
    const r = render(soloConteos);
    expect(r.html).toContain("Sin cambios");
    expect(r.html).not.toContain("Sistemas");
    expect(r.txt).toContain("Sin cambios");
    expect(r.txt).not.toContain("SISTEMAS");
  });
  it("listas recortadas dicen 'n de total' y el push con estado distinto de success se avisa", () => {
    // La RPC corta cada lista a 25 filas y manda el conteo real en n_<lista>.
    const recortado: Cambios = {
      ...cambios,
      areas: [{ area: "comercial", abiertas: 300, nuevas: [], empeoradas: [item(8)], mejoradas: [], resueltas: [], delegadas: [], graves: [item(9)], n_empeoradas: 1, n_graves: 209 }],
      salud: { odoo_push_edad_h: 0.7, odoo_push_status: "error", bot_terminada_en: "2026-09-24T12:20:00Z", sin_datos: [] },
    };
    const { html, txt } = render(recortado);
    expect(html).toContain("Graves que siguen abiertas (1 de 209)");
    expect(txt).toContain("Graves que siguen abiertas (1 de 209)");
    expect(html).toContain("Empeoraron (1)");             // n igual al largo: título normal
    expect(txt).not.toContain("Empeoraron (1 de");
    expect(html).toContain("último push: error");
    expect(txt).toContain("último push: error");
    expect(html).not.toContain("en orden");               // con alerta no se dice "en orden"
    // Sin n_<lista> ni estado del push (o success) no se agrega nada.
    const normal = render(cambios);
    expect(normal.html).not.toContain(" de 209");
    expect(normal.html).not.toContain("último push");
    expect(normal.txt).not.toContain("último push");
  });
  it("salud: bot sin corrida o con más de 3 h se avisa con las horas contra `hasta`", () => {
    const viejo = render({ ...cambios, salud: { odoo_push_edad_h: 0.7, bot_terminada_en: "2026-09-24T07:00:00Z", sin_datos: [] } });
    expect(viejo.html).toContain("bot sin corrida terminada hace 5.5 h");
    expect(viejo.txt).toContain("bot sin corrida terminada hace 5.5 h");
    expect(viejo.html).not.toContain("en orden");
    const nulo = render({ ...cambios, salud: { odoo_push_edad_h: 0.7, bot_terminada_en: null, sin_datos: [] } });
    expect(nulo.txt).toContain("Salud del mapa: bot sin corrida terminada");
    const varias = render({ ...cambios, salud: { odoo_push_edad_h: 5, bot_terminada_en: "2026-09-24T12:20:00Z", sin_datos: ["a", "b"] } });
    expect(varias.txt).toContain("Salud del mapa: push de Odoo hace 5 h · 2 señal(es) sin datos: a, b");
    expect(varias.txt).not.toContain("en orden");
  });
  it("escapa los títulos en HTML y los deja crudos en texto", () => {
    const feo: Cambios = { ...cambios, areas: [{ ...cambios.areas[0], nuevas: [item(20, { titulo: "<script>alert(1)</script>", contraparte: null }), item(21, { titulo: 'Pedido "urgente" · ACME' })] }] };
    const { html, txt } = render(feo);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Pedido &quot;urgente&quot; · ACME");
    expect(txt).toContain("<script>alert(1)</script>");
    expect(txt).toContain('Pedido "urgente" · ACME');
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
  it("inlineMd: itálicas solo cuando el asterisco pega al texto; un * suelto se queda", () => {
    expect(inlineMd("*sí* y **no**")).toBe("<em>sí</em> y <strong>no</strong>");
    expect(inlineMd("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(inlineMd("a * b y *c d* e")).toBe("a * b y <em>c d</em> e");
  });
  it("fmtInt: miles, redondeo y valores raros", () => {
    expect(fmtInt(1500)).toBe("1,500");
    expect(fmtInt(2.6)).toBe("3");
    expect(fmtInt(null)).toBe("0");
    expect(fmtInt(undefined)).toBe("0");
    expect(fmtInt(NaN)).toBe("0");
    expect(fmtInt(Infinity)).toBe("0");
  });
});

describe("situacion-digest/prompt", () => {
  const grande: Cambios = { ...cambios, areas: cambios.areas.map((a) => ({ ...a, graves: Array.from({ length: 200 }, (_, i) => item(1000 + i, { recomendacion: "x".repeat(400) })) })) };
  it("la entrada para Claude cabe en el presupuesto y conserva ids y títulos", () => {
    const txt = entradaParaClaude(grande, 20_000);
    expect(txt.length).toBeLessThanOrEqual(20_000);
    expect(txt).toContain("Cartera vencida · ACME 1");
    expect(txt).toContain('"id":1');
    expect(JSON.parse(txt)).toMatchObject({ totales: grande.totales });
    expect(SYSTEM.toLowerCase()).toContain("json");
    expect(SYSTEM).toContain("situacion_cambios");
    expect(SYSTEM).toContain("sin enlaces ni URLs");
  });
  it("con un presupuesto apretado recorta las listas y sigue siendo JSON válido dentro del presupuesto", () => {
    const txt = entradaParaClaude(grande, 5_000);
    expect(txt.length).toBeLessThanOrEqual(5_000);
    const json = JSON.parse(txt);
    expect(json.totales).toEqual(grande.totales);
    expect(json.areas[0].graves.length).toBeLessThan(25);
    expect(json.areas[0].graves[0]).toHaveProperty("cambio");  // todavía con detalle: bastó recortar filas
  });
  it("con un presupuesto imposible degrada por estructura (listas, detalle, rezago) y devuelve el JSON más chico, nunca cortado", () => {
    const txt = entradaParaClaude(grande, 1_000);
    const json = JSON.parse(txt);                              // nunca se corta a la mitad
    expect(json.totales).toEqual(grande.totales);
    expect(json.areas[0].graves.length).toBeLessThanOrEqual(2);
    expect(json.areas[0]).not.toHaveProperty("resueltas");     // se sacrifican resueltas, mejoradas y delegadas
    expect(json.areas[0]).not.toHaveProperty("mejoradas");
    expect(json.areas[0]).not.toHaveProperty("delegadas");
    expect(json.areas[0]).toHaveProperty("empeoradas");        // lo importante se queda
    expect(json.areas[0].graves[0]).not.toHaveProperty("cambio"); // luego el detalle
    expect(json.areas[0].graves[0]).toHaveProperty("titulo");
    expect(json).not.toHaveProperty("rezago");                 // y por último el rezago
    expect(txt.length).toBeLessThan(entradaParaClaude(grande, 5_000).length);
  });
});
