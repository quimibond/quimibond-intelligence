import { describe, it, expect } from "vitest";
import { handleInvoiceEvent } from "@/lib/syntage/handlers/invoice";
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

describe("handleInvoiceEvent (real Syntage schema)", () => {
  const baseEvent: SyntageEvent = {
    id: "019d989a-1234-7000-8000-000000000001",
    type: "invoice.created",
    taxpayer: { id: "PNT920218IW5" },
    data: {
      object: {
        id: "a13b04df-25a8-4052-bcbd-e9044e7effae",
        uuid: "96a5d5c5-34af-420d-a2b0-21a63c6126c3",
        type: "I",
        usage: "G03",
        status: "VIGENTE",
        paymentType: "PPD",
        paymentMethod: "99",
        currency: "MXN",
        exchangeRate: null,
        subtotal: 206263.32,
        discount: 0,
        total: 226889.65,
        issuer: { rfc: "SOB180413IN2", name: "SISTEMAS OPERATIVOS DEL BAJIO SA DE CV" },
        receiver: { rfc: "PNT920218IW5", name: "QUIMIBOND" },
        isIssuer: false,
        isReceiver: true,
        issuedAt: "2020-10-16T01:15:43Z",
        certifiedAt: "2020-10-16T01:15:45Z",
        canceledAt: null,
        transferredTaxes: { total: 33002.13 },
        retainedTaxes: { total: 12375.8 },
      },
    },
    createdAt: "2026-04-16T23:37:17Z",
  };

  it("maps a received CFDI with real Syntage schema", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    await handleInvoiceEvent(makeCtx(capture), baseEvent);
    const r = capture.row!;
    expect(r.syntage_id).toBe("a13b04df-25a8-4052-bcbd-e9044e7effae");
    expect(r.uuid).toBe("96a5d5c5-34af-420d-a2b0-21a63c6126c3");
    expect(r.direction).toBe("received");
    expect(r.tipo_comprobante).toBe("I");
    expect(r.emisor_rfc).toBe("SOB180413IN2");
    expect(r.receptor_rfc).toBe("PNT920218IW5");
    expect(r.subtotal).toBe(206263.32);
    expect(r.total).toBe(226889.65);
    expect(r.descuento).toBe(0);
    expect(r.impuestos_trasladados).toBe(33002.13);
    expect(r.impuestos_retenidos).toBe(12375.8);
    expect(r.metodo_pago).toBe("PPD");
    expect(r.forma_pago).toBe("99");
    expect(r.uso_cfdi).toBe("G03");
    expect(r.estado_sat).toBe("vigente");
    expect(r.fecha_emision).toBe("2020-10-16T01:15:43Z");
    expect(r.fecha_timbrado).toBe("2020-10-16T01:15:45Z");
    expect(r.tipo_cambio).toBe(1);
  });

  it("sets estado_sat='cancelado' when status=CANCELADO", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const obj = { ...(baseEvent.data.object as Record<string, unknown>), status: "CANCELADO", canceledAt: "2021-01-01T00:00:00Z" };
    const evt: SyntageEvent = { ...baseEvent, data: { object: obj } };
    await handleInvoiceEvent(makeCtx(capture), evt);
    expect(capture.row!.estado_sat).toBe("cancelado");
    expect(capture.row!.fecha_cancelacion).toBe("2021-01-01T00:00:00Z");
  });

  it("sets direction='issued' when isIssuer=true", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const obj = { ...(baseEvent.data.object as Record<string, unknown>), isIssuer: true, isReceiver: false };
    const evt: SyntageEvent = { ...baseEvent, data: { object: obj } };
    await handleInvoiceEvent(makeCtx(capture), evt);
    expect(capture.row!.direction).toBe("issued");
  });

  it("throws on missing id or uuid", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = { ...baseEvent, data: { object: { uuid: "x" } } };
    await expect(handleInvoiceEvent(makeCtx(capture), evt)).rejects.toThrow(/id\/uuid/);
  });
});
