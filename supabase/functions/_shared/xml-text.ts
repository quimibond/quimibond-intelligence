/**
 * XML adjunto → texto útil para la memoria. Sin dependencias (corre en Deno y en vitest).
 *
 * Un CFDI (factura, nómina, complemento de pago del SAT) trae el sello y el
 * certificado en base64: miles de caracteres que no dicen nada y que
 * ensucian la búsqueda (texto_tsv). En vez del XML crudo se produce un
 * resumen legible: quién factura a quién, cuánto, cuándo, qué conceptos, qué
 * pagos. Cualquier otro XML se aplana a `Elemento: atributo=valor …` y texto.
 */

export const XML_MAX_CHARS = 20_000;

type Attrs = Record<string, string>;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function attrsOf(tag: string): Attrs {
  const out: Attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const name = m[1].replace(/^[\w-]+:/, ""); // sin prefijo de namespace
    out[name] = decode(m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Atributos de cada elemento con ese nombre local (`Concepto`, `cfdi:Concepto`, `pago20:Pago`…). */
export function elementos(xml: string, nombre: string): Attrs[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}\\b([^>]*?)/?>`, "g");
  const out: Attrs[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(attrsOf(m[1]));
  return out;
}

export function esCfdi(xml: string): boolean {
  return /<(?:[\w-]+:)?Comprobante\b/.test(xml) && /sat\.gob\.mx\/cfd/i.test(xml);
}

const n = (v: string | undefined) => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const money = (v: string | undefined) => {
  const x = n(v);
  return x == null ? "?" : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const qty = (v: string | undefined) => {
  const x = n(v);
  return x == null ? "?" : x.toLocaleString("en-US", { maximumFractionDigits: 3 });
};
const TIPO: Record<string, string> = { I: "Ingreso", E: "Egreso", T: "Traslado", N: "Nómina", P: "Pago" };

/** Resumen legible de un CFDI 3.3 / 4.0 con sus complementos más comunes. */
export function cfdiResumen(xml: string): string {
  const c = elementos(xml, "Comprobante")[0] ?? {};
  const emisor = elementos(xml, "Emisor")[0] ?? {};
  const receptor = elementos(xml, "Receptor")[0] ?? {};
  const timbre = elementos(xml, "TimbreFiscalDigital")[0] ?? {};
  const lines: string[] = [];

  const tipo = c.TipoDeComprobante ?? "";
  const folio = [c.Serie, c.Folio].filter(Boolean).join("-");
  lines.push(
    `CFDI ${c.Version ?? ""} ${tipo}${TIPO[tipo] ? ` (${TIPO[tipo]})` : ""}${folio ? ` folio ${folio}` : ""}, fecha ${(c.Fecha ?? "").slice(0, 16).replace("T", " ")}${timbre.UUID ? `, UUID ${timbre.UUID}` : ""}${timbre.FechaTimbrado ? `, timbrado ${timbre.FechaTimbrado.slice(0, 10)}` : ""}`.trim(),
  );
  lines.push(`Emisor: ${emisor.Rfc ?? "?"} ${emisor.Nombre ?? ""}${emisor.RegimenFiscal ? ` (régimen ${emisor.RegimenFiscal})` : ""}.`.replace(/\s+\./, "."));
  lines.push(
    `Receptor: ${receptor.Rfc ?? "?"} ${receptor.Nombre ?? ""}${receptor.UsoCFDI ? ` (uso ${receptor.UsoCFDI}` : ""}${receptor.RegimenFiscalReceptor ? `, régimen ${receptor.RegimenFiscalReceptor}` : ""}${receptor.DomicilioFiscalReceptor ? `, CP ${receptor.DomicilioFiscalReceptor}` : ""}${receptor.UsoCFDI ? ")" : ""}.`,
  );
  if (tipo !== "P" && tipo !== "N") {
    const cond: string[] = [];
    if (c.Moneda) cond.push(`moneda ${c.Moneda}${c.TipoCambio && c.TipoCambio !== "1" ? ` (TC ${c.TipoCambio})` : ""}`);
    if (c.MetodoPago) cond.push(`método ${c.MetodoPago}`);
    if (c.FormaPago) cond.push(`forma ${c.FormaPago}`);
    if (c.CondicionesDePago) cond.push(`condiciones "${c.CondicionesDePago}"`);
    if (c.Exportacion && c.Exportacion !== "01") cond.push(`exportación ${c.Exportacion}`);
    if (cond.length) lines.push(cond.join("; ") + ".");
    const imp = elementos(xml, "Impuestos").filter((i) => i.TotalImpuestosTrasladados != null || i.TotalImpuestosRetenidos != null).pop() ?? {};
    const tot: string[] = [`subtotal ${money(c.SubTotal)}`];
    if (n(c.Descuento)) tot.push(`descuento ${money(c.Descuento)}`);
    if (imp.TotalImpuestosTrasladados) tot.push(`impuestos trasladados ${money(imp.TotalImpuestosTrasladados)}`);
    if (imp.TotalImpuestosRetenidos) tot.push(`retenidos ${money(imp.TotalImpuestosRetenidos)}`);
    tot.push(`total ${money(c.Total)}`);
    lines.push(tot.join("; ") + ".");
  }

  // Conceptos: la parte que la memoria necesita (qué se vendió/compró y a qué precio).
  const conceptos = elementos(xml, "Concepto");
  if (conceptos.length && tipo !== "N") {
    lines.push(`Conceptos (${conceptos.length}):`);
    for (const k of conceptos.slice(0, 40)) {
      const desc = (k.Descripcion ?? "").replace(/\s+/g, " ").trim();
      const extra: string[] = [];
      if (k.NoIdentificacion) extra.push(`ref ${k.NoIdentificacion}`);
      if (k.ClaveProdServ) extra.push(`clave ${k.ClaveProdServ}`);
      if (k.Descuento && n(k.Descuento)) extra.push(`desc. ${money(k.Descuento)}`);
      lines.push(`- ${qty(k.Cantidad)} ${k.Unidad ?? k.ClaveUnidad ?? ""} "${desc.slice(0, 160)}" @ ${money(k.ValorUnitario)} = ${money(k.Importe)}${extra.length ? ` (${extra.join(", ")})` : ""}`);
    }
    if (conceptos.length > 40) lines.push(`… y ${conceptos.length - 40} conceptos más`);
  }

  const rel = elementos(xml, "CfdiRelacionados")[0];
  const relUuids = elementos(xml, "CfdiRelacionado").map((r) => r.UUID).filter(Boolean);
  if (relUuids.length) lines.push(`Relacionados${rel?.TipoRelacion ? ` (tipo ${rel.TipoRelacion})` : ""}: ${relUuids.slice(0, 20).join(", ")}`);

  // Complemento de pago (1.0 / 2.0).
  const pagos = elementos(xml, "Pago");
  if (pagos.length) {
    const docs = elementos(xml, "DoctoRelacionado");
    lines.push(`Complemento de pago: ${pagos.length} pago(s).`);
    for (const p of pagos.slice(0, 10)) {
      lines.push(`- Pago ${(p.FechaPago ?? "").slice(0, 10)} ${p.MonedaP ?? ""} ${money(p.Monto)}${p.FormaDePagoP ? ` forma ${p.FormaDePagoP}` : ""}${p.NumOperacion ? ` op. ${p.NumOperacion}` : ""}${p.CtaBeneficiario ? ` cta ${p.CtaBeneficiario}` : ""}`);
    }
    for (const d of docs.slice(0, 30)) {
      lines.push(`  · doc ${d.IdDocumento ?? "?"}${d.Serie || d.Folio ? ` (${[d.Serie, d.Folio].filter(Boolean).join("-")})` : ""} parcialidad ${d.NumParcialidad ?? "?"}: saldo anterior ${money(d.ImpSaldoAnt)}, pagado ${money(d.ImpPagado)}, insoluto ${money(d.ImpSaldoInsoluto)}${d.MonedaDR ? ` ${d.MonedaDR}` : ""}`);
    }
  }

  // Nómina 1.2.
  const nom = elementos(xml, "Nomina")[0];
  if (nom) {
    const rec = elementos(xml, "Receptor")[1] ?? elementos(xml, "Receptor").find((r) => r.NumEmpleado) ?? {};
    lines.push(
      `Nómina ${nom.Version ?? ""} ${nom.TipoNomina === "O" ? "ordinaria" : nom.TipoNomina === "E" ? "extraordinaria" : nom.TipoNomina ?? ""}: pago ${nom.FechaPago ?? "?"} (periodo ${nom.FechaInicialPago ?? "?"} a ${nom.FechaFinalPago ?? "?"}, ${nom.NumDiasPagados ?? "?"} días); percepciones ${money(nom.TotalPercepciones)}, deducciones ${money(nom.TotalDeducciones)}${nom.TotalOtrosPagos ? `, otros pagos ${money(nom.TotalOtrosPagos)}` : ""}; neto ${money(c.Total)}.`,
    );
    const emp: string[] = [];
    if (rec.NumEmpleado) emp.push(`empleado ${rec.NumEmpleado}`);
    if (rec.Puesto) emp.push(`puesto "${rec.Puesto}"`);
    if (rec.Departamento) emp.push(`depto "${rec.Departamento}"`);
    if (rec.SalarioDiarioIntegrado) emp.push(`SDI ${money(rec.SalarioDiarioIntegrado)}`);
    if (rec.SalarioBaseCotApor) emp.push(`SBC ${money(rec.SalarioBaseCotApor)}`);
    if (rec.PeriodicidadPago) emp.push(`periodicidad ${rec.PeriodicidadPago}`);
    if (rec.FechaInicioRelLaboral) emp.push(`desde ${rec.FechaInicioRelLaboral}`);
    if (emp.length) lines.push(emp.join(", ") + ".");
    const per = elementos(xml, "Percepcion");
    const ded = elementos(xml, "Deduccion");
    if (per.length) lines.push("Percepciones: " + per.slice(0, 25).map((p) => `${p.Concepto ?? p.TipoPercepcion ?? "?"} ${money(String(n(p.ImporteGravado) ?? 0 + (n(p.ImporteExento) ?? 0)))}`).join("; "));
    if (ded.length) lines.push("Deducciones: " + ded.slice(0, 25).map((d) => `${d.Concepto ?? d.TipoDeduccion ?? "?"} ${money(d.Importe)}`).join("; "));
  }

  // Carta porte, comercio exterior, etc.: solo que existen (sin inventar).
  for (const comp of ["CartaPorte", "ComercioExterior", "Donatarias", "ImpuestosLocales"]) {
    if (new RegExp(`<(?:[\\w-]+:)?${comp}\\b`).test(xml)) lines.push(`Incluye complemento ${comp}.`);
  }
  return lines.join("\n");
}

/** XML genérico: una línea por elemento con sus atributos (sin blobs) y el texto interior. */
export function xmlPlano(xml: string): string {
  const lines: string[] = [];
  const re = /<(?!\?|!|\/)([\w:.-]+)([^>]*?)(\/?)>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && lines.length < 2000) {
    const nombre = m[1].replace(/^[\w-]+:/, "");
    const attrs = Object.entries(attrsOf(m[2])).filter(([k, v]) => !/^xmlns/.test(k) && k !== "schemaLocation" && v.length <= 200);
    let texto = decode(m[4]).replace(/\s+/g, " ").trim();
    if (texto.length > 300) texto = texto.slice(0, 297) + "…"; // sellos y blobs en texto
    if (!attrs.length && !texto) continue;
    lines.push(`${nombre}${attrs.length ? ": " + attrs.map(([k, v]) => `${k}=${v}`).join(" · ") : ""}${texto ? (attrs.length ? " | " : ": ") + texto : ""}`);
  }
  return lines.join("\n");
}

/** Punto de entrada del extractor. */
export function xmlToText(xml: string): string {
  const s = xml.replace(/^\uFEFF/, "");
  const out = esCfdi(s) ? cfdiResumen(s) : xmlPlano(s);
  return out.length > XML_MAX_CHARS ? out.slice(0, XML_MAX_CHARS - 3) + "…" : out;
}
