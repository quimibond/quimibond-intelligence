import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  fetchCompanyByIdMock,
  fetchCompany360Mock,
  fetchCompanyRevenueTrendMock,
  fetchCompanyReceivablesMock,
  getCompanyDetailMock,
} = vi.hoisted(() => ({
  fetchCompanyByIdMock: vi.fn(),
  fetchCompany360Mock: vi.fn(),
  fetchCompanyRevenueTrendMock: vi.fn(),
  fetchCompanyReceivablesMock: vi.fn(),
  getCompanyDetailMock: vi.fn(),
}));

vi.mock("@/lib/queries/_shared/companies", () => ({
  fetchCompanyById: fetchCompanyByIdMock,
  fetchCompany360: fetchCompany360Mock,
  fetchCompanyRevenueTrend: fetchCompanyRevenueTrendMock,
  fetchCompanyReceivables: fetchCompanyReceivablesMock,
  getCompanyDetail: getCompanyDetailMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empresas/868",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import EmpresaDetailPage from "@/app/empresas/[id]/page";

describe("/empresas/[id] page", () => {
  it("renders CompanyKpiHero with display_name when detail exists", async () => {
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
    });
    fetchCompanyRevenueTrendMock.mockResolvedValue([
      { month_start: "2025-06-01", total_mxn: 100_000 },
      { month_start: "2025-07-01", total_mxn: 120_000 },
    ]);
    fetchCompanyReceivablesMock.mockResolvedValue([]);
    getCompanyDetailMock.mockResolvedValue({ id: 868, name: "QUIMIBOND" });

    const ui = await EmpresaDetailPage({
      params: Promise.resolve({ id: "868" }),
      searchParams: Promise.resolve({}),
    });
    render(ui);
    expect(screen.getAllByText(/QUIMIBOND/).length).toBeGreaterThanOrEqual(1);
  });

  it("defaults to Panorama tab when ?tab= missing", async () => {
    fetchCompanyByIdMock.mockResolvedValue({ id: 868, display_name: "X", rfc: null, has_shadow_flag: false, blacklist_level: "none" });
    fetchCompany360Mock.mockResolvedValue({ canonical_company_id: 868, lifetime_value_mxn: 0, revenue_ytd_mxn: 0, overdue_amount_mxn: 0, open_company_issues_count: 0, revenue_90d_mxn: 0 });
    fetchCompanyRevenueTrendMock.mockResolvedValue([]);
    fetchCompanyReceivablesMock.mockResolvedValue([]);
    getCompanyDetailMock.mockResolvedValue({ id: 868, name: "X" });

    const ui = await EmpresaDetailPage({
      params: Promise.resolve({ id: "868" }),
      searchParams: Promise.resolve({}),
    });
    render(ui);
    expect(screen.getByText(/revenue 12 meses/i)).toBeInTheDocument();
  });

  it("renders Financiero content when ?tab=financiero", async () => {
    fetchCompanyByIdMock.mockResolvedValue({ id: 868, display_name: "X", rfc: null, has_shadow_flag: false, blacklist_level: "none" });
    fetchCompany360Mock.mockResolvedValue({ canonical_company_id: 868, lifetime_value_mxn: 0, revenue_ytd_mxn: 0, overdue_amount_mxn: 0, open_company_issues_count: 0, revenue_90d_mxn: 0 });
    fetchCompanyRevenueTrendMock.mockResolvedValue([]);
    fetchCompanyReceivablesMock.mockResolvedValue([]);
    getCompanyDetailMock.mockResolvedValue({ id: 868, name: "X" });

    const ui = await EmpresaDetailPage({
      params: Promise.resolve({ id: "868" }),
      searchParams: Promise.resolve({ tab: "financiero" }),
    });
    render(ui);
    expect(screen.getByText(/ingresos de este cliente/i)).toBeInTheDocument();
  });
});
