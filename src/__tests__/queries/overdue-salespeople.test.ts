import { describe, expect, it, vi, beforeEach } from "vitest";

const mockChain: Record<string, unknown> = {};
const state: { resolvedData: Array<{ salesperson: { display_name: string | null } | null }> } = {
  resolvedData: [],
};

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => ({ from: () => mockChain }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn, // bypass cache for tests
}));

beforeEach(() => {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq", "in", "lt", "gt", "not"]) chain[m] = passthrough;
  // The terminal await resolves the promise. Add a `then` shim so
  // `await sb.from(...).select(...)...` returns our payload.
  (chain as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
    Promise.resolve({ data: state.resolvedData, error: null }).then(cb);
  Object.assign(mockChain, chain);
});

describe("getOverdueSalespeopleOptions", () => {
  it("returns sorted unique display_name values", async () => {
    state.resolvedData = [
      { salesperson: { display_name: "Lupe Guerrero" } },
      { salesperson: { display_name: "Sandra Davila" } },
      { salesperson: { display_name: "Lupe Guerrero" } }, // duplicate
      { salesperson: { display_name: "Ana López" } },
    ];
    const { getOverdueSalespeopleOptions } = await import(
      "@/lib/queries/unified/invoices"
    );
    const out = await getOverdueSalespeopleOptions();
    expect(out).toEqual(["Ana López", "Lupe Guerrero", "Sandra Davila"]);
  });

  it("ignores null display_name and null salesperson", async () => {
    state.resolvedData = [
      { salesperson: { display_name: null } },
      { salesperson: null },
      { salesperson: { display_name: "  " } }, // whitespace only
      { salesperson: { display_name: "Sandra Davila" } },
    ];
    const { getOverdueSalespeopleOptions } = await import(
      "@/lib/queries/unified/invoices"
    );
    const out = await getOverdueSalespeopleOptions();
    expect(out).toEqual(["Sandra Davila"]);
  });

  it("returns empty array when no overdue invoices have salespeople", async () => {
    state.resolvedData = [];
    const { getOverdueSalespeopleOptions } = await import(
      "@/lib/queries/unified/invoices"
    );
    const out = await getOverdueSalespeopleOptions();
    expect(out).toEqual([]);
  });
});
