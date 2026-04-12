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

  it("acepta insight con company name del contexto", () => {
    const insight = { evidence: ["GRUPO ISMARK acumula cartera vencida"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con product_ref del contexto", () => {
    const insight = { evidence: ["KF4032T11BL se vendió bajo costo"] };
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

  it("acepta cuando description (no solo evidence) contiene anclaje", () => {
    const insight = { evidence: ["Patron detectado"], description: "GRUPO ISMARK tiene 4 facturas vencidas" };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
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
