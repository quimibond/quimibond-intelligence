import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

// Freeze time so the expected date computed in each test always matches
// the date computed inside the helper, even if a test straddles midnight.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));

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

afterEach(() => {
  vi.useRealTimers();
});

describe('getOverdueInvoicesPage bucket="90+"', () => {
  it('translates "90+" to a single due_date_odoo.lt.<today-90> filter', async () => {
    // Boundary contract: 90+ means days_overdue > 90 (strict).
    // The sibling 61-90 bucket already includes day 90 (gte.<today-90>),
    // so 90+ must use lt.<today-90> exactly — not lt.<today-89> or
    // lt.<today-91>.
    const expectedD90 = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);

    const { getOverdueInvoicesPage } = await import("@/lib/queries/unified/invoices");
    await getOverdueInvoicesPage({
      page: 1,
      size: 50,
      bucket: ["90+"],
    });

    const orPayload = captured.orParts.flat().find((s) => s.includes("due_date_odoo"));
    expect(orPayload).toBeDefined();
    expect(orPayload).toBe(`due_date_odoo.lt.${expectedD90}`);
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
