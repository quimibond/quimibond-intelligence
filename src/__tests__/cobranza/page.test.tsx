import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Suspense } from "react";

// SectionNav + HistorySelector use Next router/navigation — mock both at the
// barrel so no browser-only or app-router-only APIs are exercised in jsdom.
vi.mock("@/components/patterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/patterns")>();
  return {
    ...actual,
    SectionNav: () => null,
    HistorySelector: () => null,
  };
});

// Stub Next router context for any nested useRouter() callers.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cobranza",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/queries/unified", () => ({
  getUnifiedRefreshStaleness: vi.fn().mockResolvedValue({
    minutesSinceRefresh: 5,
    invoicesRefreshedAt: "2026-04-22T12:00:00Z",
  }),
}));

vi.mock("@/lib/queries/sp13/cobranza", () => ({
  getArKpis: vi.fn().mockResolvedValue({
    totalMxn: 0,
    totalCount: 0,
    overdueMxn: 0,
    overdueCount: 0,
    overdue90plusMxn: 0,
    overdue90plusCount: 0,
    dsoDays: null,
  }),
  getAgingBuckets: vi.fn().mockResolvedValue({
    totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    counts: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    buckets: [],
  }),
  getArByCompany: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  getActionList: vi.fn().mockResolvedValue([]),
  getDsoTrend: vi.fn().mockResolvedValue([]),
  getOpenInvoicesPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

import CobranzaPage from "@/app/cobranza/page";

async function renderPage(sp: Record<string, string>) {
  const ui = await CobranzaPage({ searchParams: Promise.resolve(sp) });
  return render(<Suspense>{ui}</Suspense>);
}

describe("CobranzaPage searchParams parsing", () => {
  it('forwards a valid bucket="31-60" to ArByCompanyTable', async () => {
    await renderPage({ bucket: "31-60" });
    const sp13 = await import("@/lib/queries/sp13/cobranza");
    await new Promise((r) => setTimeout(r, 50));
    const calls = vi.mocked(sp13.getArByCompany).mock.calls;
    expect(calls.some((c) => Array.isArray(c[0].bucket) && c[0].bucket?.[0] === "31-60")).toBe(true);
  });

  it('forwards a valid bucket="90+" to ArByCompanyTable', async () => {
    await renderPage({ bucket: "90+" });
    const sp13 = await import("@/lib/queries/sp13/cobranza");
    await new Promise((r) => setTimeout(r, 50));
    const calls = vi.mocked(sp13.getArByCompany).mock.calls;
    expect(calls.some((c) => c[0].bucket?.[0] === "90+")).toBe(true);
  });

  it("catches invalid bucket value to undefined (no bucket forwarded)", async () => {
    await renderPage({ bucket: "junk" });
    const sp13 = await import("@/lib/queries/sp13/cobranza");
    await new Promise((r) => setTimeout(r, 50));
    const lastCall = vi.mocked(sp13.getArByCompany).mock.calls.at(-1);
    expect(lastCall?.[0].bucket).toBeUndefined();
  });

  it("renders all 5 section anchors", async () => {
    await renderPage({});
    expect(document.getElementById("ar")).not.toBeNull();
    expect(document.getElementById("companies")).not.toBeNull();
    expect(document.getElementById("action")).not.toBeNull();
    expect(document.getElementById("dso")).not.toBeNull();
    expect(document.getElementById("invoices")).not.toBeNull();
  });
});
