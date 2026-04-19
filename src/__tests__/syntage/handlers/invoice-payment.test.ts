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

  it("extracts batchPayment fields inline (operationNumber, bank RFCs, batch_payment_id)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_3",
      type: "invoice_payment.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "payment-id-3",
          invoiceUuid: "inv-uuid-3",
          currency: "MXN",
          exchangeRate: 1,
          amount: 100,
          batchPayment: {
            id: "batch-3",
            "@id": "/invoices/batch-payments/batch-3",
            date: "2024-04-05 18:00:00",
            operationNumber: "FOLIO 0267850",
            paymentMethod: "01",
            payerBank: [{ rfc: "BBB010101AAA" }],
            beneficiaryBank: [{ rfc: "CCC020202BBB" }],
          },
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.batch_payment_id).toBe("/invoices/batch-payments/batch-3");
    expect(r.num_operacion).toBe("FOLIO 0267850");
    expect(r.rfc_emisor_cta_ord).toBe("BBB010101AAA");
    expect(r.rfc_emisor_cta_ben).toBe("CCC020202BBB");
    expect(r.forma_pago_p).toBe("01");
    expect(r.fecha_pago).toBe("2024-04-05 18:00:00");
  });

  it("handles empty payerBank/beneficiaryBank arrays (real Syntage data)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_4",
      type: "invoice_payment.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "payment-id-4",
          invoiceUuid: "inv-uuid-4",
          currency: "MXN",
          exchangeRate: 1,
          amount: 100,
          batchPayment: {
            id: "batch-4",
            "@id": "/invoices/batch-payments/batch-4",
            operationNumber: "OP-123",
            payerBank: [],
            beneficiaryBank: [],
          },
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), evt);
    expect(capture.row!.num_operacion).toBe("OP-123");
    expect(capture.row!.rfc_emisor_cta_ord).toBeNull();
    expect(capture.row!.rfc_emisor_cta_ben).toBeNull();
  });

  it("sets batch_payment_id and fiscal fields to null when batchPayment absent (CSV-imported shape)", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_5",
      type: "invoice_payment.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "payment-id-5",
          invoiceUuid: "inv-uuid-5",
          currency: "MXN",
          exchangeRate: 1,
          amount: 100,
          date: "2019-12-03 18:00:00",
          paymentMethod: "03",
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), evt);
    const r = capture.row!;
    expect(r.batch_payment_id).toBeNull();
    expect(r.num_operacion).toBeNull();
    expect(r.rfc_emisor_cta_ord).toBeNull();
    expect(r.rfc_emisor_cta_ben).toBeNull();
    // InvoicePayment-level fallback for fecha_pago/forma_pago_p sigue funcionando
    expect(r.fecha_pago).toBe("2019-12-03 18:00:00");
    expect(r.forma_pago_p).toBe("03");
  });
});
