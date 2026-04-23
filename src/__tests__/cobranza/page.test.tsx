import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Suspense } from "react";

// SectionNav uses IntersectionObserver + scrollIntoView — both absent in jsdom.
// Mock at the patterns barrel so no browser-only APIs are exercised.
vi.mock("@/components/patterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/patterns")>();
  return {
    ...actual,
    SectionNav: () => null,
  };
});

vi.mock("@/lib/queries/unified", () => ({
  getUnifiedRefreshStaleness: vi.fn().mockResolvedValue({
    minutesSinceRefresh: 5,
    invoicesRefreshedAt: "2026-04-22T12:00:00Z",
  }),
}));

vi.mock("@/lib/queries/unified/invoices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/unified/invoices")>();
  return {
    ...actual,
    invoicesReceivableAging: vi.fn().mockResolvedValue({
      current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0,
    }),
    getCompanyAgingPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getPaymentPredictionsPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getOverdueInvoicesPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getOverdueSalespeopleOptions: vi.fn().mockResolvedValue([]),
    getPaymentRiskKpis: vi.fn().mockResolvedValue({
      abnormalCount: 0, abnormalPending: 0, criticalCount: 0, criticalPending: 0,
    }),
  };
});

vi.mock("@/lib/queries/analytics/finance", () => ({
  getCfoSnapshot: vi.fn().mockResolvedValue({
    carteraVencida: 0, cuentasPorCobrar: 0, cobros30d: 0, clientesMorosos: 0,
  }),
}));

vi.mock("@/lib/queries/analytics", () => ({
  getCollectionEffectiveness: vi.fn().mockResolvedValue([]),
}));

import CobranzaPage from "@/app/cobranza/page";

async function renderPage(sp: Record<string, string>) {
  const ui = await CobranzaPage({ searchParams: Promise.resolve(sp) });
  return render(<Suspense>{ui}</Suspense>);
}

describe("CobranzaPage searchParams parsing", () => {
  it('forwards a valid aging="31-60" to OverdueSection (helper called with bucket=["31-60"])', async () => {
    await renderPage({ aging: "31-60" });
    const invoices = await import("@/lib/queries/unified/invoices");
    // Wait one tick for Suspense to flush
    await new Promise((r) => setTimeout(r, 50));
    const calls = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls;
    expect(calls.some((c) => Array.isArray(c[0].bucket) && c[0].bucket?.[0] === "31-60")).toBe(true);
  });

  it('forwards a valid aging="90+" to OverdueSection', async () => {
    await renderPage({ aging: "90+" });
    const invoices = await import("@/lib/queries/unified/invoices");
    await new Promise((r) => setTimeout(r, 50));
    const calls = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls;
    expect(calls.some((c) => c[0].bucket?.[0] === "90+")).toBe(true);
  });

  it("catches invalid aging value to undefined (no bucket forwarded)", async () => {
    await renderPage({ aging: "junk" });
    const invoices = await import("@/lib/queries/unified/invoices");
    await new Promise((r) => setTimeout(r, 50));
    const lastCall = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls.at(-1);
    expect(lastCall?.[0].bucket).toBeUndefined();
  });

  it("renders all 6 section anchors", async () => {
    await renderPage({});
    expect(document.getElementById("kpis")).not.toBeNull();
    expect(document.getElementById("cei")).not.toBeNull();
    expect(document.getElementById("buckets")).not.toBeNull();
    expect(document.getElementById("payment-risk")).not.toBeNull();
    expect(document.getElementById("company-aging")).not.toBeNull();
    expect(document.getElementById("overdue")).not.toBeNull();
  });
});
