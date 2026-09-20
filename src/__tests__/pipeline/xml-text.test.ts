import { describe, it, expect } from "vitest";
import { xmlToText, esCfdi, cfdiResumen, xmlPlano, elementos } from "../../../supabase/functions/_shared/xml-text";

const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="A" Folio="1234" Fecha="2026-08-01T10:15:00" Sello="${"Q".repeat(3000)}" Certificado="${"Z".repeat(4000)}" NoCertificado="00001000000500000001" SubTotal="1000.00" Descuento="50.00" Moneda="MXN" Total="1102.00" TipoDeComprobante="I" Exportacion="01" MetodoPago="PPD" FormaPago="99" CondicionesDePago="30 d&#237;as" LugarExpedicion="06600">
  <cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="AAAA-1111"/></cfdi:CfdiRelacionados>
  <cfdi:Emisor Rfc="PNT920218IW5" Nombre="PRODUCTORA DE NO TEJIDOS QUIMIBOND" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="ABC010101XYZ" Nombre="ACME TEXTIL SA DE CV" DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="601" UsoCFDI="G01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="11162100" NoIdentificacion="WJ053" Cantidad="100.5" ClaveUnidad="KGM" Unidad="Kilogramo" Descripcion="Tela no tejida 40 g &amp; acabado" ValorUnitario="10.00" Importe="1005.00" Descuento="50.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="955.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="152.80"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="152.80"><cfdi:Traslados><cfdi:Traslado Base="955.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="152.80"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="9F1C0000-0000-4000-8000-000000000001" FechaTimbrado="2026-08-01T10:16:02" SelloCFD="${"S".repeat(2000)}" NoCertificadoSAT="00001000000500000002" SelloSAT="${"T".repeat(2000)}"/></cfdi:Complemento>
</cfdi:Comprobante>`;

const PAGO = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="P" Folio="77" Fecha="2026-08-15T09:00:00" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" Exportacion="01">
  <cfdi:Emisor Rfc="ABC010101XYZ" Nombre="ACME TEXTIL SA DE CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="PNT920218IW5" Nombre="PRODUCTORA DE NO TEJIDOS QUIMIBOND" UsoCFDI="CP01"/>
  <cfdi:Complemento><pago20:Pagos Version="2.0"><pago20:Totales MontoTotalPagos="1102.00"/>
    <pago20:Pago FechaPago="2026-08-15T12:00:00" FormaDePagoP="03" MonedaP="MXN" TipoCambioP="1" Monto="1102.00" NumOperacion="778899">
      <pago20:DoctoRelacionado IdDocumento="9F1C0000-0000-4000-8000-000000000001" Serie="A" Folio="1234" MonedaDR="MXN" NumParcialidad="1" ImpSaldoAnt="1102.00" ImpPagado="1102.00" ImpSaldoInsoluto="0.00" ObjetoImpDR="02"/>
    </pago20:Pago></pago20:Pagos></cfdi:Complemento>
</cfdi:Comprobante>`;

const NOMINA = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12" Version="4.0" Serie="NOMINA" Folio="24444" Fecha="2026-09-18T08:38:09" SubTotal="5000.00" Descuento="800.00" Moneda="MXN" Total="4200.00" TipoDeComprobante="N" Exportacion="01" MetodoPago="PUE" FormaPago="99">
  <cfdi:Emisor Rfc="PNT920218IW5" Nombre="PRODUCTORA DE NO TEJIDOS QUIMIBOND" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="JUAN PEREZ" UsoCFDI="CN01"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111505" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago de nómina" ValorUnitario="5000.00" Importe="5000.00" Descuento="800.00"/></cfdi:Conceptos>
  <cfdi:Complemento><nomina12:Nomina Version="1.2" TipoNomina="O" FechaPago="2026-09-18" FechaInicialPago="2026-09-11" FechaFinalPago="2026-09-17" NumDiasPagados="7" TotalPercepciones="5000.00" TotalDeducciones="800.00">
    <nomina12:Emisor RegistroPatronal="Y1234567890"/>
    <nomina12:Receptor Curp="PEXJ800101HDFRRN09" NumSeguridadSocial="12345678901" FechaInicioRelLaboral="2020-03-01" Antig&#252;edad="P340W" TipoContrato="01" TipoRegimen="02" NumEmpleado="325" Departamento="TEJIDO" Puesto="OPERADOR" PeriodicidadPago="02" SalarioBaseCotApor="250.00" SalarioDiarioIntegrado="260.50" ClaveEntFed="DIF"/>
    <nomina12:Percepciones TotalSueldos="5000.00" TotalGravado="5000.00" TotalExento="0.00"><nomina12:Percepcion TipoPercepcion="001" Clave="001" Concepto="Sueldo" ImporteGravado="5000.00" ImporteExento="0.00"/></nomina12:Percepciones>
    <nomina12:Deducciones TotalOtrasDeducciones="300.00" TotalImpuestosRetenidos="500.00"><nomina12:Deduccion TipoDeduccion="002" Clave="002" Concepto="ISR" Importe="500.00"/><nomina12:Deduccion TipoDeduccion="001" Clave="001" Concepto="IMSS" Importe="300.00"/></nomina12:Deducciones>
  </nomina12:Nomina></cfdi:Complemento>
</cfdi:Comprobante>`;

describe("xml-text", () => {
  it("detecta CFDI por Comprobante + namespace del SAT", () => {
    expect(esCfdi(FACTURA)).toBe(true);
    expect(esCfdi("<root><a x='1'/></root>")).toBe(false);
  });

  it("resume una factura: cabecera, partes, totales y conceptos; sin sello ni certificado", () => {
    const t = cfdiResumen(FACTURA);
    expect(t).toContain("CFDI 4.0 I (Ingreso) folio A-1234, fecha 2026-08-01 10:15, UUID 9F1C0000-0000-4000-8000-000000000001");
    expect(t).toContain("Emisor: PNT920218IW5 PRODUCTORA DE NO TEJIDOS QUIMIBOND (régimen 601).");
    expect(t).toContain("Receptor: ABC010101XYZ ACME TEXTIL SA DE CV (uso G01, régimen 601, CP 64000).");
    expect(t).toContain('método PPD; forma 99; condiciones "30 días".');
    expect(t).toContain("subtotal 1,000.00; descuento 50.00; impuestos trasladados 152.80; total 1,102.00.");
    expect(t).toContain('- 100.5 Kilogramo "Tela no tejida 40 g & acabado" @ 10.00 = 1,005.00 (ref WJ053, clave 11162100, desc. 50.00)');
    expect(t).toContain("Relacionados (tipo 04): AAAA-1111");
    expect(t).not.toMatch(/Q{20}|Z{20}|S{20}|T{20}/);
    expect(t.length).toBeLessThan(1200);
  });

  it("resume un complemento de pago con sus documentos", () => {
    const t = cfdiResumen(PAGO);
    expect(t).toContain("CFDI 4.0 P (Pago) folio P-77");
    expect(t).toContain("- Pago 2026-08-15 MXN 1,102.00 forma 03 op. 778899");
    expect(t).toContain("· doc 9F1C0000-0000-4000-8000-000000000001 (A-1234) parcialidad 1: saldo anterior 1,102.00, pagado 1,102.00, insoluto 0.00 MXN");
    expect(t).not.toContain("subtotal");
  });

  it("resume una nómina con empleado, percepciones y deducciones", () => {
    const t = cfdiResumen(NOMINA);
    expect(t).toContain("Nómina 1.2 ordinaria: pago 2026-09-18 (periodo 2026-09-11 a 2026-09-17, 7 días); percepciones 5,000.00, deducciones 800.00; neto 4,200.00.");
    expect(t).toContain('empleado 325, puesto "OPERADOR", depto "TEJIDO", SDI 260.50, SBC 250.00, periodicidad 02, desde 2020-03-01.');
    expect(t).toContain("Percepciones: Sueldo 5,000.00");
    expect(t).toContain("Deducciones: ISR 500.00; IMSS 300.00");
    expect(t).not.toContain("Conceptos (");
  });

  it("aplana un XML genérico sin blobs ni namespaces", () => {
    const t = xmlPlano(`<?xml version="1.0"?><pedido xmlns="urn:x" id="77"><cliente rfc="ABC">Acme &amp; Co</cliente><linea sku="WJ053" cant="12"/><firma>${"x".repeat(500)}</firma><cert v="${"y".repeat(300)}"/></pedido>`);
    expect(t).toBe("pedido: id=77\ncliente: rfc=ABC | Acme & Co\nlinea: sku=WJ053 · cant=12\nfirma: " + "x".repeat(297) + "…");
  });

  it("xmlToText elige el camino y respeta el tope", () => {
    expect(xmlToText("﻿" + FACTURA)).toContain("CFDI 4.0");
    const big = "<r>" + "<a v='1'>t</a>".repeat(5000) + "</r>";
    expect(xmlToText(big).length).toBeLessThanOrEqual(20_000);
    expect(elementos("<a:B x='1'/><B y='2'></B>", "B")).toEqual([{ x: "1" }, { y: "2" }]);
  });
});
