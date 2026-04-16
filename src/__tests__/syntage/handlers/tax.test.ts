// src/__tests__/syntage/handlers/tax.test.ts
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
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleTaxRetentionEvent", () => {
  it("upserts a retention CFDI", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_r_1", type: "tax_retention.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-retentions/r-001",
          uuid: "r-uuid-1", direction: "received",
          fechaEmision: "2026-04-10", tipoRetencion: "arrendamiento",
          montoTotalOperacion: 10000, montoTotalGravado: 10000, montoTotalRetenido: 1000,
          estadoSat: "vigente",
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleTaxRetentionEvent(makeCtx(capture), evt);
    expect(capture.row?.uuid).toBe("r-uuid-1");
    expect(capture.row?.monto_total_retenido).toBe(1000);
  });
});

describe("handleTaxReturnEvent", () => {
  it("upserts a monthly tax return", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_tr_1", type: "tax_return.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-returns/tr-001",
          returnType: "monthly", ejercicio: 2026, periodo: "03", impuesto: "IVA",
          tipoDeclaracion: "normal", numeroOperacion: "OP-987",
          fechaPresentacion: "2026-04-17", montoPagado: 35000,
        },
      },
      createdAt: "2026-04-17T10:00:00Z",
    };
    await handleTaxReturnEvent(makeCtx(capture), evt);
    expect(capture.row?.ejercicio).toBe(2026);
    expect(capture.row?.periodo).toBe("03");
    expect(capture.row?.monto_pagado).toBe(35000);
  });
});

describe("handleTaxStatusEvent", () => {
  it("upserts opinion_cumplimiento for target_rfc", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ts_1", type: "tax_status.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-status/ts-001",
          targetRfc: "SUPPLIER_ABC", fechaConsulta: "2026-04-16",
          opinionCumplimiento: "positiva", regimenFiscal: "601",
        },
      },
      createdAt: "2026-04-16T12:00:00Z",
    };
    await handleTaxStatusEvent(makeCtx(capture), evt);
    expect(capture.row?.target_rfc).toBe("SUPPLIER_ABC");
    expect(capture.row?.opinion_cumplimiento).toBe("positiva");
  });
});
