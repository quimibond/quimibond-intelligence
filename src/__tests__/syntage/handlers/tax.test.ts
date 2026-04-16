import { describe, it, expect } from "vitest";
import { handleTaxRetentionEvent } from "@/lib/syntage/handlers/tax-retention";
import { handleTaxReturnEvent } from "@/lib/syntage/handlers/tax-return";
import { handleTaxStatusEvent } from "@/lib/syntage/handlers/tax-status";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(capture: { row?: Record<string, unknown> }): HandlerCtx {
  return {
    supabase: {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "PNT920218IW5",
  };
}

describe("handleTaxRetentionEvent (real Syntage TaxRetention schema)", () => {
  it("maps a retention CFDI with code + totals", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_r_1",
      type: "tax_retention.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          uuid: "def404af-5eef-4112-aa99-d1ec8493b89a",
          code: "26",
          issuer: { rfc: "AOM920820BEA", name: "APPLE OPERATIONS MEXICO" },
          receiver: { rfc: "PNT920218IW5", name: "QUIMIBOND", nationality: "national" },
          issuedAt: "2019-01-03T21:10:40Z",
          certifiedAt: "2019-01-03T21:10:41Z",
          canceledAt: null,
          totalOperationAmount: 59.78,
          totalTaxableAmount: 59.78,
          totalExemptAmount: 0,
          totalRetainedAmount: 6.56,
          items: [{ baseAmount: 59.78, taxType: "002", retainedAmount: 4.77, paymentType: "definitive" }],
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleTaxRetentionEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.syntage_id).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.uuid).toBe("def404af-5eef-4112-aa99-d1ec8493b89a");
    expect(r.direction).toBe("received");
    expect(r.tipo_retencion).toBe("26");
    expect(r.emisor_rfc).toBe("AOM920820BEA");
    expect(r.receptor_rfc).toBe("PNT920218IW5");
    expect(r.monto_total_retenido).toBe(6.56);
    expect(r.fecha_emision).toBe("2019-01-03T21:10:40Z");
    expect(Array.isArray(r.impuestos_retenidos)).toBe(true);
  });
});

describe("handleTaxReturnEvent (real Syntage TaxReturn schema)", () => {
  it("maps a monthly Normal tax return", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_tr_1",
      type: "tax_return.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          intervalUnit: "Mensual",
          period: "Diciembre",
          fiscalYear: "2019",
          type: "Normal",
          operationNumber: 200100172932,
          presentedAt: "2020-01-17T09:00:00Z",
          payment: { paidAmount: 35000 },
        },
      },
      createdAt: "2020-01-17T09:05:00Z",
    };
    await handleTaxReturnEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.syntage_id).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.return_type).toBe("monthly");
    expect(r.ejercicio).toBe(2019);
    expect(r.periodo).toBe("Diciembre");
    expect(r.tipo_declaracion).toBe("normal");
    expect(r.numero_operacion).toBe("200100172932");
    expect(r.monto_pagado).toBe(35000);
  });

  it("maps Complementaria type and Anual interval", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_tr_2",
      type: "tax_return.updated",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "a",
          intervalUnit: "Anual",
          period: "2020",
          fiscalYear: "2020",
          type: "Complementaria",
          operationNumber: 1,
        },
      },
      createdAt: "2020-01-01T00:00:00Z",
    };
    await handleTaxReturnEvent(makeCtx(capture), evt);
    expect(capture.row!.return_type).toBe("annual");
    expect(capture.row!.tipo_declaracion).toBe("complementaria");
    expect(capture.row!.ejercicio).toBe(2020);
  });
});

describe("handleTaxStatusEvent (real Syntage TaxStatus — constancia fiscal)", () => {
  it("maps Activo → opinion='positiva'", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ts_1",
      type: "tax_status.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          rfc: "PNT920218IW5",
          status: "Activo",
          statusUpdatedAt: "2026-04-01T00:00:00Z",
          taxRegimes: [{ code: 601, name: "Régimen General de Ley Personas Morales" }],
          economicActivities: [{ name: "Fabricación", order: "1", percentage: "100" }],
          address: { streetName: "Plaza Jorge Luis", postalCode: "29000" },
        },
      },
      createdAt: "2026-04-16T00:00:00Z",
    };
    await handleTaxStatusEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.target_rfc).toBe("PNT920218IW5");
    expect(r.opinion_cumplimiento).toBe("positiva");
    expect(r.regimen_fiscal).toBe("Régimen General de Ley Personas Morales");
    expect(Array.isArray(r.actividades_economicas)).toBe(true);
    expect(r.domicilio_fiscal).toMatchObject({ postalCode: "29000" });
  });

  it("maps Suspendido → opinion='negativa'", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ts_2",
      type: "tax_status.updated",
      taxpayer: { id: "PNT920218IW5" },
      data: { object: { id: "a", rfc: "OTHER123", status: "Suspendido" } },
      createdAt: "2026-04-16T00:00:00Z",
    };
    await handleTaxStatusEvent(makeCtx(capture), evt);
    expect(capture.row!.opinion_cumplimiento).toBe("negativa");
  });
});
