import { describe, it, expect } from "vitest";
import { handleInvoiceLineItemEvent } from "@/lib/syntage/handlers/invoice-line-item";
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

describe("handleInvoiceLineItemEvent (real Syntage InvoiceLineItem schema)", () => {
  it("maps a line item from real Syntage fields", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_li_1",
      type: "invoice_line_item.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "a13b04df-571d-42e6-af84-fb8a5c5782a6",
          invoice: { id: "a13b04df-25a8-4052-bcbd-e9044e7effae", uuid: "96a5d5c5-34af-420d-a2b0-21a63c6126c3" },
          productIdentification: "80111603",
          identificationNumber: "80111603",
          description: "SUMINISTRO DE PERSONAL",
          unitAmount: 206263.32,
          unitCode: "E48",
          quantity: 1,
          discountAmount: 0,
          totalAmount: 206263.32,
          retainedTaxes: { total: 12375.8 },
          transferredTaxes: { total: 33002.13 },
        },
      },
      createdAt: "2026-04-16T23:37:17Z",
    };
    await handleInvoiceLineItemEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.syntage_id).toBe("a13b04df-571d-42e6-af84-fb8a5c5782a6");
    expect(r.invoice_uuid).toBe("96a5d5c5-34af-420d-a2b0-21a63c6126c3");
    expect(r.clave_prod_serv).toBe("80111603");
    expect(r.descripcion).toBe("SUMINISTRO DE PERSONAL");
    expect(r.cantidad).toBe(1);
    expect(r.clave_unidad).toBe("E48");
    expect(r.valor_unitario).toBe(206263.32);
    expect(r.importe).toBe(206263.32);
    expect(r.descuento).toBe(0);
  });

  it("accepts missing invoice.uuid (soft reference — line_items may arrive before parent invoice)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_li_2",
      type: "invoice_line_item.created",
      taxpayer: { id: "PNT920218IW5" },
      data: { object: { id: "xyz", invoice: {} } },
      createdAt: "2026-04-16T23:37:17Z",
    };
    await handleInvoiceLineItemEvent(makeCtx(capture), evt);
    expect(capture.row!.syntage_id).toBe("xyz");
    expect(capture.row!.invoice_uuid).toBeNull();
  });
});
