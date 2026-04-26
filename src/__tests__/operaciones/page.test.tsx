import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getOperationsKpisMock,
  getWeeklyTrendMock,
  getDeliveriesPageMock,
  getManufacturingPageMock,
  getManufacturingAssigneeOptionsMock,
} = vi.hoisted(() => ({
  getOperationsKpisMock: vi.fn(async () => ({
    otdLatestPct: 79.1,
    otdAvg4w: 82.3,
    lateOpen: 119,
    mfgInProgress: 93,
    mfgToClose: 13,
    avgLeadDays: 5.5,
  })),
  getWeeklyTrendMock: vi.fn(async () => [] as unknown[]),
  getDeliveriesPageMock: vi.fn(async () => ({ rows: [], total: 0 })),
  getManufacturingPageMock: vi.fn(async () => ({ rows: [], total: 0 })),
  getManufacturingAssigneeOptionsMock: vi.fn(async () => [] as string[]),
}));

vi.mock("@/lib/queries/operational/operations", () => ({
  getOperationsKpis: getOperationsKpisMock,
  getWeeklyTrend: getWeeklyTrendMock,
  getDeliveriesPage: getDeliveriesPageMock,
  getManufacturingPage: getManufacturingPageMock,
  getManufacturingAssigneeOptions: getManufacturingAssigneeOptionsMock,
}));

vi.mock("./_components/otd-weekly-chart", () => ({
  OtdWeeklyChart: () => null,
}));

vi.mock("@/app/operaciones/_components/otd-weekly-chart", () => ({
  OtdWeeklyChart: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/operaciones",
  useSearchParams: () => new URLSearchParams(),
}));

import OperacionesPage from "@/app/operaciones/page";

async function renderPage(search: Record<string, string> = {}) {
  const ui = await OperacionesPage({ searchParams: Promise.resolve(search) });
  const { container } = render(ui);
  await new Promise((r) => setTimeout(r, 0));
  return container;
}

describe("/operaciones page", () => {
  it("renders the SP13 question-framed subtitle", async () => {
    await renderPage();
    expect(
      screen.getByText(/¿Estoy entregando a tiempo y qué está en producción\?/),
    ).toBeInTheDocument();
  });

  it("invokes the core operations queries on render", async () => {
    getOperationsKpisMock.mockClear();
    getWeeklyTrendMock.mockClear();
    getDeliveriesPageMock.mockClear();
    getManufacturingPageMock.mockClear();
    await renderPage();
    expect(getOperationsKpisMock).toHaveBeenCalled();
    expect(getWeeklyTrendMock).toHaveBeenCalled();
    expect(getDeliveriesPageMock).toHaveBeenCalled();
    expect(getManufacturingPageMock).toHaveBeenCalled();
  });

  it("renders the three question-first section headings", async () => {
    await renderPage();
    expect(screen.getByText(/¿Cómo va el OTD semanal\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/¿Qué entregas tengo en el piso\?/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/¿Qué se está produciendo en planta\?/),
    ).toBeInTheDocument();
  });
});
