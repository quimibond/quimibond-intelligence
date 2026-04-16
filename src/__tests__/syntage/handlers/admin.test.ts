// src/__tests__/syntage/handlers/admin.test.ts
import { describe, it, expect } from "vitest";
import { handleElectronicAccountingEvent } from "@/lib/syntage/handlers/electronic-accounting";
import {
  handleCredentialEvent,
  handleLinkEvent,
  handleExtractionEvent,
  handleFileCreatedEvent,
} from "@/lib/syntage/handlers/admin";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(capture: { table?: string; row?: Record<string, unknown> }): HandlerCtx {
  return {
    supabase: {
      from: (t: string) => ({
        upsert: (row: Record<string, unknown>) => {
          capture.table = t; capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleElectronicAccountingEvent", () => {
  it("upserts a balanza", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ea_1", type: "electronic_accounting_record.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/ea/ea-001", recordType: "balanza",
        ejercicio: 2026, periodo: "03", tipoEnvio: "normal", hash: "abc",
      } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await handleElectronicAccountingEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_electronic_accounting");
    expect(capture.row?.record_type).toBe("balanza");
  });
});

describe("handleExtractionEvent", () => {
  it("upserts an extraction row", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ex_1", type: "extraction.updated",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/extractions/ex-001",
        extractor: "invoice",
        status: "finished", options: { from: "2026-01-01", to: "2026-01-31" },
        startedAt: "2026-04-01T10:00:00Z", finishedAt: "2026-04-01T10:05:00Z",
      } },
      createdAt: "2026-04-01T10:05:00Z",
    };
    await handleExtractionEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_extractions");
    expect(capture.row?.status).toBe("finished");
    expect(capture.row?.extractor_type).toBe("invoice");
  });
});

describe("handleCredentialEvent + handleLinkEvent + handleFileCreatedEvent", () => {
  it("credential.* is a log-only no-op that does not throw", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_c_1", type: "credential.updated",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: { "@id": "/credentials/c1", status: "valid" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleCredentialEvent(makeCtx(capture), evt)).resolves.toBeUndefined();
  });

  it("link.* is a log-only no-op", async () => {
    const evt: SyntageEvent = {
      id: "evt_l_1", type: "link.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: { "@id": "/links/l1" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleLinkEvent(makeCtx({}), evt)).resolves.toBeUndefined();
  });

  it("file.created upserts a syntage_files row", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_f_1", type: "file.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/files/f-001", fileType: "cfdi_xml",
        filename: "abc.xml", mimeType: "text/xml", sizeBytes: 4096,
        downloadUrlCachedUntil: "2026-04-17T10:00:00Z",
      } },
      createdAt: "2026-04-16T10:00:00Z",
    };
    await handleFileCreatedEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_files");
    expect(capture.row?.file_type).toBe("cfdi_xml");
    expect(capture.row?.filename).toBe("abc.xml");
  });
});
