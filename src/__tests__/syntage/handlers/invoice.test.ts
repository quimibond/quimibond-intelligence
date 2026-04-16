import { describe, it, expect } from "vitest";
import { handleInvoiceEvent } from "@/lib/syntage/handlers/invoice";
import type { SyntageEvent } from "@/lib/syntage/types";

function makeCtx(onUpsert: (row: Record<string, unknown>) => void) {
  return {
    supabase: {
      from: (_table: string) => ({
        upsert: (row: Record<string, unknown>, _opts?: unknown) => {
          onUpsert(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleInvoiceEvent", () => {
  const baseEvent: SyntageEvent = {
    id: "evt_1",
    type: "invoice.created",
    taxpayer: { id: "QIN120315XX1" },
    data: {
      object: {
        "@id": "/invoices/abc-123",
        uuid: "abc-uuid-1234-5678-9012-345678901234",
        direction: "received",
        tipoComprobante: "I",
        serie: "A",
        folio: "100",
        fechaEmision: "2026-04-15T10:00:00Z",
        issuer: { rfc: "SUPPLIER_RFC", name: "Proveedor X" },
        receiver: { rfc: "QIN120315XX1", name: "Quimibond Industrial" },
        subtotal: 100,
        total: 116,
        moneda: "MXN",
        tipoCambio: 1,
        estadoSat: "vigente",
      },
    },
    createdAt: "2026-04-15T10:05:00Z",
  };

  it("upserts a CFDI with denormalized fields + raw_payload", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = makeCtx(row => { captured = row; });
    await handleInvoiceEvent(ctx, baseEvent);
    expect(captured.syntage_id).toBe("/invoices/abc-123");
    expect(captured.uuid).toBe("abc-uuid-1234-5678-9012-345678901234");
    expect(captured.direction).toBe("received");
    expect(captured.emisor_rfc).toBe("SUPPLIER_RFC");
    expect(captured.receptor_rfc).toBe("QIN120315XX1");
    expect(captured.total).toBe(116);
    expect(captured.taxpayer_rfc).toBe("QIN120315XX1");
    expect(captured.odoo_company_id).toBe(1);
    expect(captured.estado_sat).toBe("vigente");
    expect(captured.raw_payload).toEqual(baseEvent.data.object);
  });

  it("sets estado_sat='cancelado' on invoice.deleted event", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = makeCtx(row => { captured = row; });
    const evt: SyntageEvent = { ...baseEvent, type: "invoice.deleted" };
    await handleInvoiceEvent(ctx, evt);
    expect(captured.estado_sat).toBe("cancelado");
    expect(captured.fecha_cancelacion).toBeTruthy();
  });
});
