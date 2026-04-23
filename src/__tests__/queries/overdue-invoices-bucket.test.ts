import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Supabase client BEFORE import
const mockChain: Record<string, unknown> = {};
const captured: { orParts: string[][] } = { orParts: [] };

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => ({
    from: () => mockChain,
  }),
}));

vi.mock("@/lib/queries/_shared/companies", () => ({
  getSelfCompanyIds: vi.fn().mockResolvedValue([1]),
}));

beforeEach(() => {
  captured.orParts = [];
  // Build a chainable mock that records `.or()` payloads
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of [
    "select", "eq", "not", "in", "lt", "gt", "gte", "ilike",
    "order", "range",
  ]) chain[m] = passthrough;
  chain.or = (s: string) => {
    captured.orParts.push([s]);
    return chain;
  };
  // Resolve when range() is awaited
  chain.range = () =>
    Promise.resolve({ data: [], count: 0, error: null });
  Object.assign(mockChain, chain);
});

describe('getOverdueInvoicesPage bucket="90+"', () => {
  it('translates "90+" to a single due_date_odoo.lt.<today-90> filter', async () => {
    const { getOverdueInvoicesPage } = await import("@/lib/queries/unified/invoices");
    await getOverdueInvoicesPage({
      page: 1,
      size: 50,
      bucket: ["90+"],
    });
    // Find the call to .or() containing the bucket filter
    const orPayload = captured.orParts.flat().find((s) => s.includes("due_date_odoo"));
    expect(orPayload).toBeDefined();
    // 90+ collapses 91-120 + 120+ into one branch: due_date_odoo.lt.<d90>
    expect(orPayload).toMatch(/due_date_odoo\.lt\.\d{4}-\d{2}-\d{2}/);
    // Should NOT include any "and(" range — 90+ is a half-open lt, not a range
    expect(orPayload).not.toMatch(/and\(due_date_odoo\.gte/);
  });

  it('still honors legacy "91-120" with a range filter (back-compat)', async () => {
    const { getOverdueInvoicesPage } = await import("@/lib/queries/unified/invoices");
    await getOverdueInvoicesPage({
      page: 1,
      size: 50,
      bucket: ["91-120"],
    });
    const orPayload = captured.orParts.flat().find((s) => s.includes("due_date_odoo"));
    expect(orPayload).toBeDefined();
    expect(orPayload).toMatch(/and\(due_date_odoo\.gte\.\d{4}-\d{2}-\d{2},due_date_odoo\.lt\.\d{4}-\d{2}-\d{2}\)/);
  });
});
