import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for the `src/lib/queries/fiscal/syntage-*` query layer.
 *
 * Covers (none of these had unit tests before):
 *  - syntage-files.ts:getSyntageFilesSummary / getSyntageFilesRecent
 *  - webhook-events.ts:getWebhookEventsSummary / getWebhookEventsRecent
 *  - syntage-health.ts:getSyntageHealth (focus: health-signal classifier)
 *
 * Each `from(table)` call is dispensed the next response in a per-table
 * FIFO queue. This is the natural fit because the queries above use
 * Promise.all with multiple parallel reads against the same table.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
  count?: number;
}

const state = {
  byTable: new Map<string, QueuedResponse[]>(),
  callIdx: new Map<string, number>(),
  // Filters captured per call, in the order the calls happened (across tables).
  callLog: [] as Array<{ table: string; idx: number; filters: Array<{ method: string; args: unknown[] }> }>,
};

function makeChain(response: QueuedResponse, filters: Array<{ method: string; args: unknown[] }>) {
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      filters.push({ method, args });
      return chain;
    };
  for (const m of [
    "select",
    "eq",
    "in",
    "is",
    "lte",
    "gte",
    "lt",
    "not",
    "or",
    "ilike",
    "order",
    "limit",
  ]) {
    chain[m] = record(m);
  }
  // Terminator: count queries return { count, data: null, error: null };
  // data queries return { data: [...], error: null }.
  chain.maybeSingle = () =>
    Promise.resolve({
      data: response.data ?? null,
      error: response.error ?? null,
      count: response.count ?? null,
    });
  (chain as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    Promise.resolve({
      data: response.data ?? null,
      error: response.error ?? null,
      count: response.count ?? null,
    }).then(cb);
  return chain;
}

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const idx = state.callIdx.get(table) ?? 0;
      state.callIdx.set(table, idx + 1);
      const queue = state.byTable.get(table) ?? [];
      const response = queue[idx] ?? { data: [], error: null, count: 0 };
      const filters: Array<{ method: string; args: unknown[] }> = [];
      state.callLog.push({ table, idx, filters });
      return makeChain(response, filters);
    },
  }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
}));

beforeEach(() => {
  state.byTable.clear();
  state.callIdx.clear();
  state.callLog.length = 0;
});

function setQueue(table: string, queue: QueuedResponse[]) {
  state.byTable.set(table, queue);
}

// ─────────────────────────────────────────────────────────────────────
// syntage-files.ts
// ─────────────────────────────────────────────────────────────────────
describe("getSyntageFilesSummary", () => {
  it("returns zeros + empty distribution when there are no files", async () => {
    // 4 parallel reads on syntage_files: totalQ, storageQ, recentQ, typesQ.
    setQueue("syntage_files", [
      { count: 0 },             // totalQ
      { count: 0 },             // storageQ (with storage_path)
      { data: [] },             // recentQ
      { data: [] },             // typesQ
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    const out = await getSyntageFilesSummary();
    expect(out).toEqual({
      total: 0,
      with_storage: 0,
      without_storage: 0,
      by_type: [],
      most_recent: null,
    });
  });

  it("derives without_storage = total - with_storage", async () => {
    setQueue("syntage_files", [
      { count: 130_421 },                               // total
      { count: 110_000 },                               // with storage
      { data: [{ created_at: "2026-04-28T12:00:00Z" }] }, // recent
      { data: [] },                                      // types (empty distribution OK)
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    const out = await getSyntageFilesSummary();
    expect(out.total).toBe(130_421);
    expect(out.with_storage).toBe(110_000);
    expect(out.without_storage).toBe(20_421);
    expect(out.most_recent).toBe("2026-04-28T12:00:00Z");
  });

  it("aggregates by_type sorted desc and capped at 12 entries", async () => {
    // Generate 15 distinct types to confirm the slice(0, 12) cap.
    const typesData: Array<{ file_type: string | null }> = [];
    for (let i = 0; i < 15; i++) {
      const count = 100 - i; // type-0 most frequent, type-14 least
      for (let j = 0; j < count; j++) typesData.push({ file_type: `type-${i}` });
    }
    setQueue("syntage_files", [
      { count: 1500 },
      { count: 1500 },
      { data: [] },
      { data: typesData },
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    const out = await getSyntageFilesSummary();
    expect(out.by_type).toHaveLength(12);
    expect(out.by_type[0]).toEqual({ file_type: "type-0", count: 100 });
    expect(out.by_type[11]).toEqual({ file_type: "type-11", count: 89 });
  });

  it("renders null file_type rows as the literal string '(null)'", async () => {
    setQueue("syntage_files", [
      { count: 3 },
      { count: 3 },
      { data: [] },
      {
        data: [
          { file_type: "PDF" },
          { file_type: null },
          { file_type: null },
        ],
      },
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    const out = await getSyntageFilesSummary();
    expect(out.by_type).toEqual([
      { file_type: "(null)", count: 2 },
      { file_type: "PDF", count: 1 },
    ]);
  });

  it("throws a friendly error when the totals query fails", async () => {
    setQueue("syntage_files", [
      { error: { message: "permission denied for relation syntage_files" } },
      { count: 0 },
      { data: [] },
      { data: [] },
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    await expect(getSyntageFilesSummary()).rejects.toThrow(
      /syntage_files total failed: permission denied/,
    );
  });

  it("throws when the storage-count query fails", async () => {
    setQueue("syntage_files", [
      { count: 100 },
      { error: { message: "timeout" } },
      { data: [] },
      { data: [] },
    ]);
    const { getSyntageFilesSummary } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    await expect(getSyntageFilesSummary()).rejects.toThrow(
      /syntage_files storage failed: timeout/,
    );
  });
});

describe("getSyntageFilesRecent", () => {
  it("returns rows ordered by created_at desc, limited to N", async () => {
    setQueue("syntage_files", [
      {
        data: [
          {
            id: 1,
            syntage_id: "sid-1",
            taxpayer_rfc: "QBO123456",
            file_type: "PDF",
            filename: "factura.pdf",
            mime_type: "application/pdf",
            size_bytes: 12345,
            storage_path: "s3://bucket/factura.pdf",
            created_at: "2026-04-28T10:00:00Z",
          },
        ],
      },
    ]);
    const { getSyntageFilesRecent } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    const rows = await getSyntageFilesRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].syntage_id).toBe("sid-1");

    const call = state.callLog.find((c) => c.table === "syntage_files");
    const order = call?.filters.find((f) => f.method === "order");
    expect(order?.args[0]).toBe("created_at");
    const limit = call?.filters.find((f) => f.method === "limit");
    expect(limit?.args).toEqual([10]);
  });

  it("defaults to limit=30 when none provided", async () => {
    setQueue("syntage_files", [{ data: [] }]);
    const { getSyntageFilesRecent } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    await getSyntageFilesRecent();
    const call = state.callLog.find((c) => c.table === "syntage_files");
    const limit = call?.filters.find((f) => f.method === "limit");
    expect(limit?.args).toEqual([30]);
  });

  it("propagates a friendly error message", async () => {
    setQueue("syntage_files", [
      { error: { message: "connection reset" } },
    ]);
    const { getSyntageFilesRecent } = await import(
      "@/lib/queries/fiscal/syntage-files"
    );
    await expect(getSyntageFilesRecent()).rejects.toThrow(
      /syntage_files recent failed: connection reset/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// webhook-events.ts
// ─────────────────────────────────────────────────────────────────────
describe("getWebhookEventsSummary", () => {
  // 6 parallel reads on syntage_webhook_events:
  //   totalQ, h24Q, d7Q, d30Q, recentQ, typesQ
  it("returns zeros and empty by_type when no events", async () => {
    setQueue("syntage_webhook_events", [
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { data: [] },
      { data: [] },
    ]);
    const { getWebhookEventsSummary } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    const out = await getWebhookEventsSummary();
    expect(out).toEqual({
      total: 0,
      last_24h: 0,
      last_7d: 0,
      last_30d: 0,
      most_recent: null,
      by_type: [],
    });
  });

  it("threads counts and most_recent from each parallel query", async () => {
    setQueue("syntage_webhook_events", [
      { count: 10_000 },
      { count: 250 },
      { count: 1_500 },
      { count: 7_500 },
      { data: [{ received_at: "2026-04-28T18:30:00Z" }] },
      {
        data: [
          { event_type: "invoice.created" },
          { event_type: "invoice.created" },
          { event_type: "invoice.updated" },
          { event_type: "payment.created" },
        ],
      },
    ]);
    const { getWebhookEventsSummary } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    const out = await getWebhookEventsSummary();
    expect(out.total).toBe(10_000);
    expect(out.last_24h).toBe(250);
    expect(out.last_7d).toBe(1_500);
    expect(out.last_30d).toBe(7_500);
    expect(out.most_recent).toBe("2026-04-28T18:30:00Z");
    expect(out.by_type).toEqual([
      { event_type: "invoice.created", count: 2 },
      { event_type: "invoice.updated", count: 1 },
      { event_type: "payment.created", count: 1 },
    ]);
  });

  it("caps by_type at 10 entries", async () => {
    const typesData: Array<{ event_type: string | null }> = [];
    for (let i = 0; i < 12; i++) {
      const count = 50 - i;
      for (let j = 0; j < count; j++) typesData.push({ event_type: `evt-${i}` });
    }
    setQueue("syntage_webhook_events", [
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { data: [] },
      { data: typesData },
    ]);
    const { getWebhookEventsSummary } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    const out = await getWebhookEventsSummary();
    expect(out.by_type).toHaveLength(10);
    expect(out.by_type[0].event_type).toBe("evt-0");
  });

  it("throws when the totals query fails", async () => {
    setQueue("syntage_webhook_events", [
      { error: { message: "view missing" } },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { data: [] },
      { data: [] },
    ]);
    const { getWebhookEventsSummary } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    await expect(getWebhookEventsSummary()).rejects.toThrow(
      /webhook_events total failed: view missing/,
    );
  });
});

describe("getWebhookEventsRecent", () => {
  it("returns events ordered by received_at desc with the requested limit", async () => {
    setQueue("syntage_webhook_events", [
      {
        data: [
          {
            event_id: "evt-1",
            event_type: "invoice.created",
            source: "syntage",
            received_at: "2026-04-28T18:30:00Z",
          },
        ],
      },
    ]);
    const { getWebhookEventsRecent } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    const rows = await getWebhookEventsRecent(50);
    expect(rows).toHaveLength(1);
    const call = state.callLog.find((c) => c.table === "syntage_webhook_events");
    const order = call?.filters.find((f) => f.method === "order");
    expect(order?.args[0]).toBe("received_at");
    const limit = call?.filters.find((f) => f.method === "limit");
    expect(limit?.args).toEqual([50]);
  });

  it("defaults to limit=20", async () => {
    setQueue("syntage_webhook_events", [{ data: [] }]);
    const { getWebhookEventsRecent } = await import(
      "@/lib/queries/fiscal/webhook-events"
    );
    await getWebhookEventsRecent();
    const call = state.callLog.find((c) => c.table === "syntage_webhook_events");
    const limit = call?.filters.find((f) => f.method === "limit");
    expect(limit?.args).toEqual([20]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// syntage-health.ts — focus on the health-signal classifier
// ─────────────────────────────────────────────────────────────────────
describe("getSyntageHealth — health signal classifier", () => {
  /**
   * Health logic:
   *   if any extraction.status='failed' OR has error_code → critical
   *   else if error_rate_pct > 5 → critical
   *   else if error_rate_pct > 1 → warn
   *   else if syntage_webhook_events count = 0 → warn
   *   else healthy
   *
   * We mock the 11 row-count tables, syntage_extractions, the cross-check
   * triplet (syntage_invoices count, odoo_invoices count, syntage_invoices
   * uuid list), the error-rate triplet (syntage_webhook_events count + 2x
   * pipeline_logs), and the yearly distribution.
   */
  const HEALTH_TABLES = [
    "syntage_webhook_events",
    "syntage_taxpayers",
    "syntage_extractions",
    "syntage_invoices",
    "syntage_invoice_line_items",
    "syntage_invoice_payments",
    "syntage_tax_retentions",
    "syntage_tax_returns",
    "syntage_tax_status",
    "syntage_electronic_accounting",
    "syntage_files",
  ];

  function setupBaseMocks(opts: {
    webhooksLast1h?: number;
    errorsLast1h?: number;
    extractionStatus?: "success" | "failed";
    extractionErrorCode?: string | null;
  }) {
    // getRowCounts: 11 tables, each returning { count: 1 } except
    // syntage_webhook_events which we control via webhooksLast1h>0.
    for (const t of HEALTH_TABLES) {
      // Each table is queried exactly once for row count.
      // syntage_webhook_events is queried 3 times total (rowCount + 1h count + error_rate count).
      // syntage_invoices is queried 3 times (rowCount + cross-check count + uuid list + yearly distribution = 4).
      // syntage_extractions is queried 2 times (rowCount + extractions list).
      // odoo_invoices is queried 2 times (cross-check count + uuid match loop, but with empty uuid list the loop is skipped).
      setQueue(t, []); // placeholder; overridden below per table
    }

    // Row counts (FIRST .from(t) per HEALTH_TABLES)
    setQueue("syntage_webhook_events", [
      { count: opts.webhooksLast1h && opts.webhooksLast1h > 0 ? 1000 : 0 }, // rowCount
      // Cross-check error-rate uses 1h window — second call.
      { count: opts.webhooksLast1h ?? 0 },
    ]);
    setQueue("syntage_taxpayers", [{ count: 1 }]);
    setQueue("syntage_extractions", [
      { count: 1 }, // rowCount
      // getExtractions list — second call.
      {
        data: [
          {
            syntage_id: "abcd1234567890",
            extractor_type: "INVOICES",
            status: opts.extractionStatus ?? "success",
            started_at: "2026-04-28T00:00:00Z",
            finished_at: "2026-04-28T00:05:00Z",
            rows_produced: 100,
            raw_payload: {
              totalDataPoints: 100,
              createdDataPoints: 90,
              updatedDataPoints: 10,
              errorCode: opts.extractionErrorCode ?? null,
            },
          },
        ],
      },
    ]);
    setQueue("syntage_invoices", [
      { count: 1 }, // rowCount
      // Cross-check first: count of all syntage_invoices.
      { count: 0 },
      // Cross-check uuid list (limit 20000) → empty bypasses the chunk loop.
      { data: [] },
      // Yearly distribution.
      { data: [] },
    ]);
    setQueue("syntage_invoice_line_items", [{ count: 1 }]);
    setQueue("syntage_invoice_payments", [{ count: 1 }]);
    setQueue("syntage_tax_retentions", [{ count: 1 }]);
    setQueue("syntage_tax_returns", [{ count: 1 }]);
    setQueue("syntage_tax_status", [{ count: 1 }]);
    setQueue("syntage_electronic_accounting", [{ count: 1 }]);
    setQueue("syntage_files", [{ count: 1 }]);

    // odoo_invoices: 1 cross-check count call (uuid list is empty, so the
    // chunk match loop is skipped entirely).
    setQueue("odoo_invoices", [{ count: 0 }]);

    // pipeline_logs: error-rate triplet calls 2x.
    setQueue("pipeline_logs", [
      { count: opts.errorsLast1h ?? 0 }, // errors count
      { data: [] },                       // sample errors
    ]);
  }

  it("returns 'critical' when an extraction has status='failed'", async () => {
    setupBaseMocks({
      webhooksLast1h: 100,
      errorsLast1h: 0,
      extractionStatus: "failed",
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("critical");
  });

  it("returns 'critical' when an extraction has error_code set", async () => {
    setupBaseMocks({
      webhooksLast1h: 100,
      errorsLast1h: 0,
      extractionStatus: "success",
      extractionErrorCode: "EXTRACTOR_TIMEOUT",
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("critical");
  });

  it("returns 'critical' when error_rate_pct > 5", async () => {
    setupBaseMocks({
      webhooksLast1h: 100,
      errorsLast1h: 6, // 6/100 = 6% > 5
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("critical");
    expect(report.error_rate.error_rate_pct).toBe(6);
  });

  it("returns 'warn' when error_rate_pct is in (1, 5]", async () => {
    setupBaseMocks({
      webhooksLast1h: 100,
      errorsLast1h: 2, // 2% — > 1 but ≤ 5
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("warn");
    expect(report.error_rate.error_rate_pct).toBe(2);
  });

  it("returns 'warn' when there were 0 webhooks in the row-count window (and no other criticals)", async () => {
    setupBaseMocks({
      webhooksLast1h: 0, // rowCount also becomes 0 → triggers the "no webhooks" warn
      errorsLast1h: 0,
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("warn");
  });

  it("returns 'healthy' when extractions ok, error_rate ≤ 1, and webhooks > 0", async () => {
    setupBaseMocks({
      webhooksLast1h: 100,
      errorsLast1h: 0,
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.health).toBe("healthy");
    expect(report.error_rate.error_rate_pct).toBe(0);
  });

  it("computes error_rate_pct rounded to one decimal", async () => {
    setupBaseMocks({
      webhooksLast1h: 1000,
      errorsLast1h: 7, // 7/1000 = 0.7%
    });
    const { getSyntageHealth } = await import(
      "@/lib/queries/fiscal/syntage-health"
    );
    const report = await getSyntageHealth();
    expect(report.error_rate.error_rate_pct).toBe(0.7);
    // 0.7% is below the 1% warn threshold → healthy
    expect(report.health).toBe("healthy");
  });
});
