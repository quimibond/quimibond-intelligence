import { describe, it, expect } from "vitest";
import { handleInvoicePaymentEvent } from "@/lib/syntage/handlers/invoice-payment";
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

describe("handleInvoicePaymentEvent (real Syntage InvoicePayment schema)", () => {
  it("maps a received payment (positive amount)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_1",
      type: "invoice_payment.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          invoiceUuid: "def404af-5eef-4112-aa99-d1ec8493b89a",
          currency: "MXN",
          exchangeRate: 1,
          installment: 3,
          previousBalance: 53249.8,
          amount: 53249.8,
          outstandingBalance: 0,
          invoice: "/invoices/91106968-1abd-4d64-85c1-4e73d96fb997",
          batchPayment: "/invoices/batch-payments/abc123",
          canceledAt: null,
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.syntage_id).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.uuid_complemento).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.direction).toBe("received");
    expect(r.monto).toBe(53249.8);
    expect(r.moneda_p).toBe("MXN");
    expect(r.tipo_cambio_p).toBe(1);
    expect(r.estado_sat).toBe("vigente");
    const doctos = r.doctos_relacionados as Array<Record<string, unknown>>;
    expect(doctos).toHaveLength(1);
    expect(doctos[0].uuid_docto).toBe("def404af-5eef-4112-aa99-d1ec8493b89a");
    expect(doctos[0].parcialidad).toBe(3);
    expect(doctos[0].imp_pagado).toBe(53249.8);
    expect(doctos[0].imp_saldo_insoluto).toBe(0);
  });

  it("derives direction='issued' from negative amount (expense)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_2",
      type: "invoice_payment.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "11111111-2222-3333-4444-555555555555",
          invoiceUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          currency: "MXN",
          exchangeRate: 1,
          installment: 1,
          previousBalance: 1000,
          amount: -1000,
          outstandingBalance: 0,
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), evt);
    expect(capture.row!.direction).toBe("issued");
    expect(capture.row!.monto).toBe(1000);
  });
});
