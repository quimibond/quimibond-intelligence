import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  fetchCompanyByIdMock,
  fetchCompany360Mock,
  fetchCompanyRevenueTrendMock,
  fetchCompanyReceivablesMock,
  getCompanyDetailMock,
  getCompanyOrdersMock,
  getCompanyRecentInsightsMock,
} = vi.hoisted(() => ({
  fetchCompanyByIdMock: vi.fn(),
  fetchCompany360Mock: vi.fn(),
  fetchCompanyRevenueTrendMock: vi.fn(),
  fetchCompanyReceivablesMock: vi.fn(),
  getCompanyDetailMock: vi.fn(),
  getCompanyOrdersMock: vi.fn(async () => []),
  getCompanyRecentInsightsMock: vi.fn(async () => []),
}));

vi.mock("@/lib/queries/_shared/companies", () => ({
  fetchCompanyById: fetchCompanyByIdMock,
  fetchCompany360: fetchCompany360Mock,
  fetchCompanyRevenueTrend: fetchCompanyRevenueTrendMock,
  fetchCompanyReceivables: fetchCompanyReceivablesMock,
  getCompanyDetail: getCompanyDetailMock,
  getCompanyOrders: getCompanyOrdersMock,
  getCompanyRecentInsights: getCompanyRecentInsightsMock,
}));

vi.mock("@/lib/queries/canonical/company-drift", () => ({
  getCompanyDrift: vi.fn(async () => null),
  getCompanyDriftRows: vi.fn(async () => []),
  shouldShowDriftTab: vi.fn(() => false),
}));

// Las secciones pesadas (async, con queries propias) se stubbean: este test
// valida el cableado de la ficha 360, no el contenido de cada sección.
vi.mock("@/app/empresas/[id]/_components/ComercialTab", () => ({
  ComercialTab: () => <div data-testid="seccion-comercial" />,
}));
vi.mock("@/app/empresas/[id]/_components/OperativoTab", () => ({
  OperativoTab: () => <div data-testid="seccion-operativo" />,
}));
vi.mock("@/app/empresas/[id]/_components/PagosTab", () => ({
  PagosTab: () => <div data-testid="seccion-pagos" />,
}));
vi.mock("@/app/empresas/[id]/_components/FiscalTab", () => ({
  FiscalTab: () => <div data-testid="seccion-fiscal" />,
}));
vi.mock("@/app/empresas/[id]/_components/AuditoriaSatTab", () => ({
  AuditoriaSatTab: () => <div data-testid="seccion-auditoria" />,
}));
vi.mock("@/components/comms/CommsTimeline", () => ({
  CommsTimeline: () => <div data-testid="seccion-comms" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empresas/868",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import EmpresaDetailPage from "@/app/empresas/[id]/page";

function mockCompany(overrides: Record<string, unknown> = {}) {
  fetchCompanyByIdMock.mockResolvedValue({
    id: 868,
    display_name: "QUIMIBOND",
    rfc: "PNT920218IW5",
    has_shadow_flag: false,
    blacklist_level: "none",
  });
  fetchCompany360Mock.mockResolvedValue({
    canonical_company_id: 868,
    lifetime_value_mxn: 100_000_000,
    revenue_ytd_mxn: 50_000_000,
    overdue_amount_mxn: 0,
    open_company_issues_count: 0,
    revenue_90d_mxn: 10_000_000,
    tier: "A",
    risk_level: "low",
    otd_rate_90d: 95,
    max_days_overdue: 0,
    last_invoice_date: "2026-08-01",
    last_email_at: "2026-08-05T10:00:00Z",
    email_count: 42,
    risk_signals: [],
    ...overrides,
  });
  fetchCompanyRevenueTrendMock.mockResolvedValue([
    { month_start: "2025-06-01", total_mxn: 100_000 },
    { month_start: "2025-07-01", total_mxn: 120_000 },
  ]);
  fetchCompanyReceivablesMock.mockResolvedValue([]);
  getCompanyDetailMock.mockResolvedValue({ id: 868, name: "QUIMIBOND" });
}

async function renderPage() {
  const ui = await EmpresaDetailPage({
    params: Promise.resolve({ id: "868" }),
    searchParams: Promise.resolve({}),
  });
  render(ui);
}

describe("/empresas/[id] ficha 360", () => {
  it("renders CompanyKpiHero with display_name", async () => {
    mockCompany();
    await renderPage();
    expect(screen.getAllByText(/QUIMIBOND/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Salud section with tier and risk from gold_company_360", async () => {
    mockCompany({ tier: "A", risk_level: "high" });
    await renderPage();
    expect(screen.getByText(/salud de la relación/i)).toBeInTheDocument();
    expect(screen.getByText(/^Alto$/)).toBeInTheDocument();
  });

  it("renders all sections stacked (no tabs) including Panorama content", async () => {
    mockCompany();
    await renderPage();
    // Panorama es sync y renderiza su contenido real
    expect(screen.getByText(/revenue 12 meses/i)).toBeInTheDocument();
    // Las demás secciones existen como anclas en la misma página
    for (const id of ["salud", "panorama", "comercial", "operativo", "pagos", "comunicaciones", "fiscal"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    // Sin drift no se muestra auditoría SAT
    expect(document.getElementById("auditoria-sat")).toBeNull();
  });
});
