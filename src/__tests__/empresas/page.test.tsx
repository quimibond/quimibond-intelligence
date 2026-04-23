import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { listCompaniesMock, fetchPortfolioKpisMock } = vi.hoisted(() => ({
  listCompaniesMock: vi.fn(async (_: unknown) => [] as unknown[]),
  fetchPortfolioKpisMock: vi.fn(async () => ({
    lifetime_value_mxn_total: 847_000_000,
    customers_count: 2197,
    suppliers_count: 312,
    blacklist_count: 17,
  })),
}));

vi.mock("@/lib/queries/_shared/companies", () => ({
  listCompanies: listCompaniesMock,
  fetchPortfolioKpis: fetchPortfolioKpisMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empresas",
}));

import EmpresasPage from "@/app/empresas/page";

describe("/empresas page", () => {
  it("renders 4 KPIs from fetchPortfolioKpis", async () => {
    listCompaniesMock.mockResolvedValue([]);
    const ui = await EmpresasPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(fetchPortfolioKpisMock).toHaveBeenCalled();
    expect(screen.getAllByText(/LTV/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Clientes/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Proveedores/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lista negra/i).length).toBeGreaterThanOrEqual(1);
  });

  it("calls listCompanies with parsed filters from searchParams", async () => {
    listCompaniesMock.mockClear();
    listCompaniesMock.mockResolvedValue([]);
    await EmpresasPage({
      searchParams: Promise.resolve({ type: "customer", blacklist: "69b_definitivo", q: "contitech" }),
    });
    expect(listCompaniesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyCustomers: true,
        blacklistLevel: "69b_definitivo",
        search: "contitech",
      })
    );
  });

  it("coerces invalid type via zod to 'all' (no onlyCustomers/onlySuppliers)", async () => {
    listCompaniesMock.mockClear();
    listCompaniesMock.mockResolvedValue([]);
    await EmpresasPage({ searchParams: Promise.resolve({ type: "bogus" }) });
    const call = listCompaniesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.onlyCustomers).toBeFalsy();
    expect(call.onlySuppliers).toBeFalsy();
  });

  it("filters rows client-side when shadowOnly=true", async () => {
    listCompaniesMock.mockResolvedValue([
      { canonical_company_id: 1, display_name: "Shadow X", has_shadow_flag: true, rfc: "AAA", is_customer: true, is_supplier: false, blacklist_level: "none", lifetime_value_mxn: 0, revenue_ytd_mxn: 0, overdue_amount_mxn: 0, open_company_issues_count: 0 },
      { canonical_company_id: 2, display_name: "Normal Y", has_shadow_flag: false, rfc: "BBB", is_customer: true, is_supplier: false, blacklist_level: "none", lifetime_value_mxn: 0, revenue_ytd_mxn: 0, overdue_amount_mxn: 0, open_company_issues_count: 0 },
    ]);
    const ui = await EmpresasPage({ searchParams: Promise.resolve({ shadowOnly: "true" }) });
    render(ui);
    expect(screen.getByText(/Shadow X/)).toBeInTheDocument();
    expect(screen.queryByText(/Normal Y/)).toBeNull();
  });
});
