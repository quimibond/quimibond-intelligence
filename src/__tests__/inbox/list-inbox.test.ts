import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for `listInbox()` in `src/lib/queries/intelligence/inbox.ts`.
 *
 * Critical paths (post commit a0824c2):
 * - q escape of %, _, \\  → ilike pattern stays literal
 * - q whitespace / empty / absent  → no ilike applied
 * - severity / canonicalEntityType / assigneeCanonicalContactId  → eq filters
 * - over-fetch = ceil(limit * 1.5), capped at 200
 * - stale-invoice filter (filterStaleInvoiceIssues)
 *   · rows with INVOICE_STALE_INVARIANTS pointing to a canonical_invoice
 *     with sat_uuid OR has_sat_record=true → filtered out
 *   · result sliced to opts.limit AFTER filtering
 *
 * Mocks @/lib/supabase-server with a per-table chain that records filter calls
 * and resolves to a preconfigured payload. Bypasses unstable_cache (irrelevant
 * here — listInbox is uncached, but we mock for safety).
 */

interface TableState {
  data: unknown;
  error: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
}

const state: { byTable: Map<string, TableState> } = {
  byTable: new Map(),
};

function ensureTable(table: string): TableState {
  let t = state.byTable.get(table);
  if (!t) {
    t = { data: [], error: null, filters: [] };
    state.byTable.set(table, t);
  }
  return t;
}

function makeChain(tableState: TableState) {
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      tableState.filters.push({ method, args });
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
  // .maybeSingle() and the awaited chain both resolve to {data, error}.
  chain.maybeSingle = () =>
    Promise.resolve({ data: tableState.data, error: tableState.error });
  (chain as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    Promise.resolve({ data: tableState.data, error: tableState.error }).then(cb);
  return chain;
}

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => ({
    from: (table: string) => makeChain(ensureTable(table)),
  }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
}));

beforeEach(() => {
  state.byTable.clear();
});

// Helpers — find a captured filter call by method (and optional first arg)
function findFilter(
  table: string,
  method: string,
  firstArg?: unknown,
): { method: string; args: unknown[] } | undefined {
  const t = state.byTable.get(table);
  if (!t) return undefined;
  return t.filters.find(
    (f) =>
      f.method === method &&
      (firstArg === undefined || f.args[0] === firstArg),
  );
}

describe("listInbox — q-escape (commit a0824c2 ilike on description)", () => {
  it("does NOT add ilike when q is omitted", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox();
    expect(findFilter("gold_ceo_inbox", "ilike")).toBeUndefined();
  });

  it("does NOT add ilike when q is empty string", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "" });
    expect(findFilter("gold_ceo_inbox", "ilike")).toBeUndefined();
  });

  it("does NOT add ilike when q is whitespace only", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "   " });
    expect(findFilter("gold_ceo_inbox", "ilike")).toBeUndefined();
  });

  it("wraps plain q in %...% when no special chars", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "shawmut" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%shawmut%"]);
  });

  it("trims whitespace before wrapping", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "   shawmut  " });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%shawmut%"]);
  });

  it("escapes % in user input so Postgres ilike treats it as a literal", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "100% match" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    // The leading/trailing % are wildcards we add; the inner % is escaped to \%
    expect(ilike?.args).toEqual(["description", "%100\\% match%"]);
  });

  it("escapes _ in user input", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "INV_001" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%INV\\_001%"]);
  });

  it("escapes backslash in user input", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "C:\\path" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%C:\\\\path%"]);
  });

  it("escapes all three special chars in a mixed string", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "a%b_c\\d" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%a\\%b\\_c\\\\d%"]);
  });

  it("preserves non-special unicode (acentos, ñ) untouched", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ q: "compañía de méxico" });
    const ilike = findFilter("gold_ceo_inbox", "ilike");
    expect(ilike?.args).toEqual(["description", "%compañía de méxico%"]);
  });
});

describe("listInbox — filter forwarding", () => {
  it("forwards severity as eq filter", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ severity: "critical" });
    const eq = findFilter("gold_ceo_inbox", "eq", "severity");
    expect(eq?.args).toEqual(["severity", "critical"]);
  });

  it("forwards canonicalEntityType as eq filter", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ canonicalEntityType: "invoice" });
    const eq = findFilter("gold_ceo_inbox", "eq", "canonical_entity_type");
    expect(eq?.args).toEqual(["canonical_entity_type", "invoice"]);
  });

  it("forwards assigneeCanonicalContactId as eq filter", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ assigneeCanonicalContactId: 42 });
    const eq = findFilter(
      "gold_ceo_inbox",
      "eq",
      "assignee_canonical_contact_id",
    );
    expect(eq?.args).toEqual(["assignee_canonical_contact_id", 42]);
  });

  it("does NOT forward assigneeCanonicalContactId when value is 0 (falsy guard relies on typeof number)", async () => {
    // Code uses `typeof opts.assigneeCanonicalContactId === "number"`, so 0
    // SHOULD be forwarded (it's a valid number). Guard against accidental
    // truthy-only filters.
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ assigneeCanonicalContactId: 0 });
    const eq = findFilter(
      "gold_ceo_inbox",
      "eq",
      "assignee_canonical_contact_id",
    );
    expect(eq?.args).toEqual(["assignee_canonical_contact_id", 0]);
  });

  it("orders by priority_score desc with nullsFirst=false", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox();
    const order = findFilter("gold_ceo_inbox", "order");
    expect(order?.args).toEqual([
      "priority_score",
      { ascending: false, nullsFirst: false },
    ]);
  });
});

describe("listInbox — over-fetch math (limit * 1.5, cap 200)", () => {
  it("default limit=50 → fetchLimit=75", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox();
    const limit = findFilter("gold_ceo_inbox", "limit");
    expect(limit?.args).toEqual([75]);
  });

  it("limit=100 → fetchLimit=150", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ limit: 100 });
    const limit = findFilter("gold_ceo_inbox", "limit");
    expect(limit?.args).toEqual([150]);
  });

  it("limit=200 → fetchLimit=200 (cap)", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ limit: 200 });
    const limit = findFilter("gold_ceo_inbox", "limit");
    expect(limit?.args).toEqual([200]);
  });

  it("limit=1000 → fetchLimit capped at 200", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ limit: 1000 });
    const limit = findFilter("gold_ceo_inbox", "limit");
    expect(limit?.args).toEqual([200]);
  });

  it("limit=33 → fetchLimit=ceil(33*1.5)=50", async () => {
    ensureTable("gold_ceo_inbox").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox({ limit: 33 });
    const limit = findFilter("gold_ceo_inbox", "limit");
    expect(limit?.args).toEqual([50]);
  });
});

describe("listInbox — stale invoice filter (defensive read-time filter)", () => {
  function staleRow(odooInvoiceId: number, invariantKey: string) {
    return {
      issue_id: `iss-${odooInvoiceId}`,
      invariant_key: invariantKey,
      canonical_entity_id: `odoo:${odooInvoiceId}`,
      canonical_entity_type: "invoice",
      severity: "critical",
      description: `Issue ${odooInvoiceId}`,
      priority_score: 90,
      detected_at: "2026-04-20T10:00:00Z",
    };
  }
  function nonStaleRow(invariantKey: string, id = 999) {
    return {
      issue_id: `iss-${id}`,
      invariant_key: invariantKey,
      canonical_entity_id: `odoo:${id}`,
      canonical_entity_type: "invoice",
      severity: "high",
      description: `Other issue ${id}`,
      priority_score: 50,
      detected_at: "2026-04-20T10:00:00Z",
    };
  }

  it("does NOT query canonical_invoices when no rows have stale invariants", async () => {
    ensureTable("gold_ceo_inbox").data = [
      nonStaleRow("invoice.amount_mismatch"),
      nonStaleRow("payment.complement_without_payment"),
    ];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    const out = await listInbox();
    expect(out).toHaveLength(2);
    // canonical_invoices should not have been queried
    expect(state.byTable.has("canonical_invoices")).toBe(false);
  });

  it("does NOT query canonical_invoices when stale-invariant rows have non-odoo entity_id", async () => {
    ensureTable("gold_ceo_inbox").data = [
      {
        ...staleRow(1, "invoice.posted_without_uuid"),
        canonical_entity_id: "uuid:abc-def", // SAT-only, no odoo: prefix
      },
    ];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    const out = await listInbox();
    expect(out).toHaveLength(1);
    expect(state.byTable.has("canonical_invoices")).toBe(false);
  });

  it("removes posted_without_uuid issue when canonical_invoice now has sat_uuid", async () => {
    ensureTable("gold_ceo_inbox").data = [
      staleRow(123, "invoice.posted_without_uuid"),
      staleRow(456, "invoice.posted_without_uuid"),
      nonStaleRow("invoice.amount_mismatch", 789),
    ];
    ensureTable("canonical_invoices").data = [
      // 123 has been timbrado since the issue was emitted — stale
      { odoo_invoice_id: 123, sat_uuid: "uuid-123-abc", has_sat_record: true },
      // 456 still genuinely posted_without_uuid
      { odoo_invoice_id: 456, sat_uuid: null, has_sat_record: false },
    ];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    const out = await listInbox();
    const ids = out.map((r) => (r as { issue_id: string }).issue_id);
    expect(ids).toEqual(["iss-456", "iss-789"]);
  });

  it("removes missing_sat_timbrado issue when canonical_invoice has has_sat_record=true (even with null uuid)", async () => {
    ensureTable("gold_ceo_inbox").data = [
      staleRow(7, "invoice.missing_sat_timbrado"),
    ];
    ensureTable("canonical_invoices").data = [
      // null uuid but has_sat_record=true → the SAT side is captured even
      // without UUID (e.g. Syntage detected the receipt). Issue is stale.
      { odoo_invoice_id: 7, sat_uuid: null, has_sat_record: true },
    ];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    const out = await listInbox();
    expect(out).toHaveLength(0);
  });

  it("queries canonical_invoices via .in() with the odoo_invoice_id list", async () => {
    ensureTable("gold_ceo_inbox").data = [
      staleRow(111, "invoice.posted_without_uuid"),
      staleRow(222, "invoice.missing_sat_timbrado"),
    ];
    ensureTable("canonical_invoices").data = [];
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await listInbox();
    const inCall = findFilter("canonical_invoices", "in");
    expect(inCall?.args[0]).toBe("odoo_invoice_id");
    const ids = inCall?.args[1] as number[];
    expect(new Set(ids)).toEqual(new Set([111, 222]));
  });
});

describe("listInbox — slice to opts.limit after stale filter", () => {
  function row(id: number, priority: number, invariant = "invoice.amount_mismatch") {
    return {
      issue_id: `iss-${id}`,
      invariant_key: invariant,
      canonical_entity_id: `odoo:${id}`,
      canonical_entity_type: "invoice",
      severity: "high",
      description: `Issue ${id}`,
      priority_score: priority,
      detected_at: "2026-04-20T10:00:00Z",
    };
  }

  it("returns at most opts.limit rows even when DB returned over-fetch count", async () => {
    // Over-fetch (75 default for limit=50) returns 75 rows; we want only 50.
    const rows = Array.from({ length: 75 }, (_, i) => row(i + 1, 100 - i));
    ensureTable("gold_ceo_inbox").data = rows;
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    const out = await listInbox(); // default limit=50
    expect(out).toHaveLength(50);
    // Should preserve order from upstream (already sorted by priority desc).
    expect((out[0] as { issue_id: string }).issue_id).toBe("iss-1");
    expect((out[49] as { issue_id: string }).issue_id).toBe("iss-50");
  });
});

describe("listInbox — error propagation", () => {
  it("throws when gold_ceo_inbox query errors", async () => {
    ensureTable("gold_ceo_inbox").error = new Error("view not found");
    ensureTable("gold_ceo_inbox").data = null;
    const { listInbox } = await import("@/lib/queries/intelligence/inbox");
    await expect(listInbox()).rejects.toThrow("view not found");
  });
});
