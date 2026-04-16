import { describe, it, expect, vi } from "vitest";
import { dispatchSyntageEvent, type DispatcherHandlers } from "@/lib/syntage/dispatcher";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(): HandlerCtx {
  return {
    supabase: {} as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "RFC",
  };
}

function makeHandlers(): DispatcherHandlers {
  return {
    invoice: vi.fn().mockResolvedValue(undefined),
    invoiceLineItem: vi.fn().mockResolvedValue(undefined),
    invoicePayment: vi.fn().mockResolvedValue(undefined),
    taxRetention: vi.fn().mockResolvedValue(undefined),
    taxReturn: vi.fn().mockResolvedValue(undefined),
    taxStatus: vi.fn().mockResolvedValue(undefined),
    electronicAccounting: vi.fn().mockResolvedValue(undefined),
    credential: vi.fn().mockResolvedValue(undefined),
    link: vi.fn().mockResolvedValue(undefined),
    extraction: vi.fn().mockResolvedValue(undefined),
    fileCreated: vi.fn().mockResolvedValue(undefined),
  };
}

function evt(type: string): SyntageEvent {
  return {
    id: `evt_${type}`, type,
    taxpayer: { id: "RFC" },
    data: { object: { "@id": "/x/1" } },
    createdAt: "2026-04-16T00:00:00Z",
  };
}

describe("dispatchSyntageEvent", () => {
  it("routes invoice.created to invoice handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice.created"), h);
    expect(h.invoice).toHaveBeenCalledOnce();
  });

  it("routes invoice.deleted to invoice handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice.deleted"), h);
    expect(h.invoice).toHaveBeenCalledOnce();
  });

  it("routes invoice_payment.updated to payment handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice_payment.updated"), h);
    expect(h.invoicePayment).toHaveBeenCalledOnce();
  });

  it("routes electronic_accounting_record.* to eAccounting handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("electronic_accounting_record.created"), h);
    expect(h.electronicAccounting).toHaveBeenCalledOnce();
  });

  it("returns 'unhandled' for unknown event types without throwing", async () => {
    const h = makeHandlers();
    const result = await dispatchSyntageEvent(makeCtx(), evt("unknown.type"), h);
    expect(result).toBe("unhandled");
    Object.values(h).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("returns 'handled' for known types", async () => {
    const h = makeHandlers();
    const result = await dispatchSyntageEvent(makeCtx(), evt("invoice.created"), h);
    expect(result).toBe("handled");
  });
});
