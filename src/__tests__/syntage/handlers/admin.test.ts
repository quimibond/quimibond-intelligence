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
    taxpayerRfc: "PNT920218IW5",
  };
}

describe("handleElectronicAccountingEvent (real Syntage schema)", () => {
  it("maps a Balanza Normal via fileType=BN", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ea_1", type: "electronic_accounting_record.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          year: 2022,
          month: 3,
          type: null,
          reason: "EM",
          fileType: "BN",
          filename: "PNT920218IW5202203BN.zip",
          code: "0001211000000000040254",
        },
      },
      createdAt: "2022-04-01T00:00:00Z",
    };
    await handleElectronicAccountingEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_electronic_accounting");
    const r = capture.row!;
    expect(r.syntage_id).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.record_type).toBe("balanza");
    expect(r.ejercicio).toBe(2022);
    expect(r.periodo).toBe("03");
    expect(r.tipo_envio).toBe("EM");
    expect(r.hash).toBe("0001211000000000040254");
  });

  it("maps a Catálogo via fileType=CT", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ea_2", type: "electronic_accounting_record.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "a18fb8fa-a74b-4be0-af40-e4e21865362f",
          year: 2021, month: 10, type: null,
          reason: "EM", fileType: "CT",
          filename: "PNT920218IW5202110CT.zip",
          code: "0001211000000000040254",
        },
      },
      createdAt: "2021-12-02T18:38:53Z",
    };
    await handleElectronicAccountingEvent(makeCtx(capture), evt);
    expect(capture.row!.record_type).toBe("catalogo_cuentas");
  });

  it("throws when fileType is unknown", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ea_3", type: "electronic_accounting_record.created",
      taxpayer: { id: "PNT920218IW5" },
      data: { object: { id: "x", year: 2022, month: 1, fileType: "XX", filename: "x.zip" } },
      createdAt: "2022-02-01T00:00:00Z",
    };
    await expect(handleElectronicAccountingEvent(makeCtx(capture), evt)).rejects.toThrow(/required fields/);
  });
});

describe("handleExtractionEvent (real Syntage Extraction schema)", () => {
  it("upserts with rows_produced = created + updated data points", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ex_1", type: "extraction.updated",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "a18f9f48-4483-4fca-ba06-a2b45931e123",
          extractor: "invoice",
          status: "finished",
          options: { period: { from: "2026-04-01", to: "2026-04-30" } },
          startedAt: "2026-04-16T23:30:51Z",
          finishedAt: "2026-04-16T23:37:14Z",
          errorCode: null,
          createdDataPoints: 37,
          updatedDataPoints: 0,
        },
      },
      createdAt: "2026-04-16T23:37:15Z",
    };
    await handleExtractionEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_extractions");
    const r = capture.row!;
    expect(r.syntage_id).toBe("a18f9f48-4483-4fca-ba06-a2b45931e123");
    expect(r.status).toBe("finished");
    expect(r.extractor_type).toBe("invoice");
    expect(r.rows_produced).toBe(37);
  });
});

describe("handleCredentialEvent + handleLinkEvent + handleFileCreatedEvent", () => {
  it("credential.* is a log-only no-op", async () => {
    const evt: SyntageEvent = {
      id: "evt_c_1", type: "credential.updated",
      taxpayer: { id: "PNT920218IW5" },
      data: { object: { id: "c1", status: "valid" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleCredentialEvent(makeCtx({}), evt)).resolves.toBeUndefined();
  });

  it("link.* is a log-only no-op", async () => {
    const evt: SyntageEvent = {
      id: "evt_l_1", type: "link.created",
      taxpayer: { id: "PNT920218IW5" },
      data: { object: { id: "l1" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleLinkEvent(makeCtx({}), evt)).resolves.toBeUndefined();
  });

  it("file.created maps real Syntage File schema (type, size, extension)", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_f_1", type: "file.created",
      taxpayer: { id: "PNT920218IW5" },
      data: {
        object: {
          id: "91106968-1abd-4d64-85c1-4e73d96fb997",
          type: "cfdi_xml",
          resource: "/invoices/abc-123",
          mimeType: "text/xml",
          extension: "xml",
          size: 4096,
          filename: "cfdi-abc.xml",
        },
      },
      createdAt: "2026-04-16T10:00:00Z",
    };
    await handleFileCreatedEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_files");
    const r = capture.row!;
    expect(r.syntage_id).toBe("91106968-1abd-4d64-85c1-4e73d96fb997");
    expect(r.file_type).toBe("cfdi_xml");
    expect(r.filename).toBe("cfdi-abc.xml");
    expect(r.size_bytes).toBe(4096);
  });
});
