import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getDashboardKpisMock,
  getTopAtRiskClientsMock,
  getRevenueTrendMock,
  getInsightsMock,
  getActiveTripwiresMock,
} = vi.hoisted(() => ({
  getDashboardKpisMock: vi.fn(async () => ({
    revenue: { this_month: 8_787_682, last_month: 16_066_217, ytd: 46_242_753 },
    collections: {
      total_overdue_mxn: 11_349_256,
      overdue_count: 206,
      expected_collections_30d: 10_398_371,
      clients_at_risk: 18,
    },
    cash: {
      cash_mxn: 486_961,
      cash_usd: 162_893,
      total_mxn: 3_376_985,
      runway_days: 0,
    },
    insights: {
      new_count: 14,
      urgent_count: 25,
      acted_this_month: 61,
      acceptance_rate: 61.6,
    },
    predictions: {
      reorders_overdue: 28,
      reorders_lost: 194,
      reorders_at_risk_mxn: 0,
      payments_at_risk: 5,
      payments_improving: 28,
    },
    operations: {
      otd_rate: 79.1,
      pending_deliveries: 133,
      late_deliveries: 119,
      manufacturing_active: 93,
      overdue_activities: 5722,
    },
    generated_at: "2026-04-26T06:51:51Z",
  })),
  getTopAtRiskClientsMock: vi.fn(async () => [] as unknown[]),
  getRevenueTrendMock: vi.fn(async () => [] as unknown[]),
  getInsightsMock: vi.fn(async () => [] as unknown[]),
  getActiveTripwiresMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/queries/analytics/dashboard", () => ({
  getDashboardKpis: getDashboardKpisMock,
  getTopAtRiskClients: getTopAtRiskClientsMock,
  getRevenueTrend: getRevenueTrendMock,
}));

vi.mock("@/lib/queries/intelligence/insights", () => ({
  getInsights: getInsightsMock,
  isVisibleToCEO: () => true,
}));

vi.mock("@/lib/queries/analytics", () => ({
  getActiveTripwires: getActiveTripwiresMock,
}));

vi.mock("./_components/revenue-trend-chart", () => ({
  RevenueTrendChart: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import CeoDashboardPage from "@/app/page";

async function renderPage(search: Record<string, string> = {}) {
  const ui = await CeoDashboardPage({ searchParams: Promise.resolve(search) });
  const { container } = render(ui);
  await new Promise((r) => setTimeout(r, 0));
  return container;
}

describe("/ (CEO dashboard)", () => {
  it("renders the SP13 question-framed subtitle", async () => {
    await renderPage();
    expect(
      screen.getByText(/¿Cuánto tengo, qué quema hoy y en qué debo enfocarme\?/),
    ).toBeInTheDocument();
  });

  it("invokes the four core queries on default render", async () => {
    getDashboardKpisMock.mockClear();
    getTopAtRiskClientsMock.mockClear();
    getRevenueTrendMock.mockClear();
    getInsightsMock.mockClear();
    getActiveTripwiresMock.mockClear();
    await renderPage();
    expect(getDashboardKpisMock).toHaveBeenCalled();
    expect(getInsightsMock).toHaveBeenCalled();
    expect(getRevenueTrendMock).toHaveBeenCalled();
    expect(getTopAtRiskClientsMock).toHaveBeenCalled();
    expect(getActiveTripwiresMock).toHaveBeenCalled();
  });

  it("renders the four question-first section headings", async () => {
    await renderPage();
    expect(
      screen.getByText(/¿Cómo está la salud del negocio\?/),
    ).toBeInTheDocument();
    expect(screen.getByText(/¿Qué quema hoy\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿Cómo viene la facturación\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/¿Quién está en riesgo de irse\?/),
    ).toBeInTheDocument();
  });
});
