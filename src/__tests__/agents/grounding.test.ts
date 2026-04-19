import { describe, it, expect } from "vitest";
import { hasConcreteEvidence, looksLikeMetaHallucination } from "@/lib/agents/grounding";

describe("hasConcreteEvidence", () => {
  const sampleContext = `
## CARTERA VENCIDA POR EMPRESA
[{"name":"GRUPO ISMARK","overdue_amount":450000},{"name":"BRAZZI","overdue_amount":120000}]

## VENTAS BAJO COSTO
[{"move_name":"INV/2026/01/0075","product_ref":"KF4032T11BL","company_name":"GRUPO ISMARK"}]
`;

  it("acepta insight con invoice name del contexto", () => {
    const insight = { evidence: ["La factura INV/2026/01/0075 tiene margen -42%"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con product_ref del contexto", () => {
    const insight = { evidence: ["KF4032T11BL se vendio bajo costo"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con email address concreto", () => {
    const insight = { evidence: ["Email de ventas@blantex.com.mx sin respuesta"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("rechaza insight sin evidence", () => {
    const insight = { evidence: [] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });

  it("rechaza insight con evidence generica no anclada al contexto", () => {
    const insight = { evidence: ["Los margenes estan bajos en general", "Hay varios problemas"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });

  it("rechaza cuando evidence es null o undefined", () => {
    expect(hasConcreteEvidence({ evidence: null }, sampleContext)).toBe(false);
    expect(hasConcreteEvidence({}, sampleContext)).toBe(false);
  });

  // Audit 2026-04-15 sprint 2: hardened grounding. Company name alone is
  // NO LONGER enough — must be paired with a concrete number (MXN, %, date,
  // or count of a noun).
  it("rechaza insight con solo company name y sin cantidad", () => {
    const insight = { evidence: ["GRUPO ISMARK acumula cartera vencida"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });

  it("acepta insight con company name + conteo especifico de facturas", () => {
    const insight = { evidence: ["Patron detectado"], description: "GRUPO ISMARK tiene 4 facturas vencidas" };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con company name + monto MXN", () => {
    const insight = { evidence: ["BRAZZI con $120K en cartera vencida"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con company name + porcentaje", () => {
    const insight = { evidence: ["GRUPO ISMARK con caida de 35% en revenue"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con company name + fecha especifica", () => {
    const insight = { evidence: ["BRAZZI no paga desde 15-mar"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con UUID_SAT (Fase 6)", () => {
    const insight = { evidence: ["CFDI 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d emitido sin factura en Odoo"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con UUID_SAT uppercase", () => {
    const insight = { evidence: ["CFDI 1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D posted-cancelado"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con RFC mexicano de 13 chars (persona física)", () => {
    const insight = { evidence: ["RFC MEMJ800101ABC detectado en 69-B"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con RFC mexicano de 12 chars (moral)", () => {
    const insight = { evidence: ["RFC PNT920218IW5 con 5,200 CFDIs huérfanos"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("rechaza UUID mal formado (sólo guiones)", () => {
    const insight = { evidence: ["CFDI 1234-5678-9abc"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });
});

describe("looksLikeMetaHallucination", () => {
  it("flag insight sobre sesiones del CEO", () => {
    const insight = { title: "Director financiero ausente en sesiones del CEO", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight sobre interacciones entre directores", () => {
    const insight = { title: "Falta de interaccion entre agentes", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight sobre governance del sistema", () => {
    const insight = { title: "x", description: "El Director de Riesgo no esta participando en la gobernanza" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight que menciona 'activar director'", () => {
    const insight = { title: "Activar Director Financiero para decisiones criticas", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("NO flag insight legitimo de negocio aunque mencione 'financiero'", () => {
    const insight = { title: "Cartera vencida de GRUPO ISMARK", description: "El cliente tiene 4 facturas vencidas >90d" };
    expect(looksLikeMetaHallucination(insight)).toBe(false);
  });

  it("NO flag insight legitimo que mencione 'sistema' en contexto de negocio", () => {
    const insight = { title: "Sistema de produccion con backlog alto", description: "MRP reporta 15 ordenes atrasadas" };
    expect(looksLikeMetaHallucination(insight)).toBe(false);
  });
});
