// src/__tests__/syntage/handlers/invoice-payment.test.ts
import { describe, it, expect } from "vitest";
import { handleInvoicePaymentEvent } from "@/lib/syntage/handlers/invoice-payment";
import type { SyntageEvent } from "@/lib/syntage/types";

function makeCtx(capture: { row?: Record<string, unknown> }) {
  return {
    supabase: {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 2,
    taxpayerRfc: "QCO170508YY2",
  };
}

describe("handleInvoicePaymentEvent", () => {
  it("upserts Tipo P with doctos_relacionados as JSONB", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const event: SyntageEvent = {
      id: "evt_pay_1",
      type: "invoice_payment.created",
      taxpayer: { id: "QCO170508YY2" },
      data: {
        object: {
          "@id": "/invoice-payments/pp-001",
          uuid: "pp-uuid-0001",
          direction: "received",
          fechaPago: "2026-04-10T00:00:00Z",
          formaPagoP: "03",
          monedaP: "MXN",
          tipoCambioP: 1,
          monto: 1000,
          numOperacion: "TRF-123456",
          rfcEmisorCtaOrd: "BBVA",
          rfcEmisorCtaBen: "BANORTE",
          doctosRelacionados: [
            { uuidDocto: "abc-123", parcialidad: 1, impPagado: 1000, impSaldoInsoluto: 0 },
          ],
          estadoSat: "vigente",
        },
      },
      createdAt: "2026-04-10T01:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), event);
    const row = capture.row!;
    expect(row.uuid_complemento).toBe("pp-uuid-0001");
    expect(row.monto).toBe(1000);
    expect(row.num_operacion).toBe("TRF-123456");
    expect(Array.isArray(row.doctos_relacionados)).toBe(true);
    expect((row.doctos_relacionados as unknown[]).length).toBe(1);
    expect(row.odoo_company_id).toBe(2);
  });
});
