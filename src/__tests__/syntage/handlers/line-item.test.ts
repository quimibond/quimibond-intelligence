// src/__tests__/syntage/handlers/line-item.test.ts
import { describe, it, expect } from "vitest";
import { handleInvoiceLineItemEvent } from "@/lib/syntage/handlers/invoice-line-item";
import type { SyntageEvent } from "@/lib/syntage/types";

describe("handleInvoiceLineItemEvent", () => {
  it("upserts a line item linked to an invoice by invoice_uuid", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = {
      supabase: {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            captured = row;
            return Promise.resolve({ error: null });
          },
        }),
      } as unknown as import("@supabase/supabase-js").SupabaseClient,
      odooCompanyId: 1,
      taxpayerRfc: "QIN120315XX1",
    };
    const event: SyntageEvent = {
      id: "evt_li_1",
      type: "invoice_line_item.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/invoice-line-items/li-001",
          invoice: { uuid: "abc-uuid-1234" },
          lineNumber: 1,
          claveProdServ: "82101500",
          descripcion: "Servicio de consultoría",
          cantidad: 10,
          claveUnidad: "E48",
          unidad: "Servicio",
          valorUnitario: 100,
          importe: 1000,
          descuento: 0,
        },
      },
      createdAt: "2026-04-15T10:06:00Z",
    };
    await handleInvoiceLineItemEvent(ctx, event);
    expect(captured.invoice_uuid).toBe("abc-uuid-1234");
    expect(captured.line_number).toBe(1);
    expect(captured.clave_prod_serv).toBe("82101500");
    expect(captured.importe).toBe(1000);
  });
});
