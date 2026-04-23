import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getPortfolioKpisMock,
  getTopLtvCustomersMock,
  getDriftingCompaniesMock,
  getCompaniesPageMock,
} = vi.hoisted(() => ({
  getPortfolioKpisMock: vi.fn(async () => ({
    activeCustomers: 156,
    activeSuppliers: 42,
    dormant: 88,
    blacklist: 17,
  })),
  getTopLtvCustomersMock: vi.fn(async () => [] as unknown[]),
  getDriftingCompaniesMock: vi.fn(async () => [] as unknown[]),
  getCompaniesPageMock: vi.fn<(args?: unknown) => Promise<{
    rows: unknown[];
    total: number;
    page: number;
    limit: number;
  }>>(async () => ({
    rows: [],
    total: 0,
    page: 1,
    limit: 25,
  })),
}));

vi.mock("@/lib/queries/sp13/empresas", () => ({
  getPortfolioKpis: getPortfolioKpisMock,
  getTopLtvCustomers: getTopLtvCustomersMock,
  getDriftingCompanies: getDriftingCompaniesMock,
  getCompaniesPage: getCompaniesPageMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empresas",
  useSearchParams: () => new URLSearchParams(),
}));

import EmpresasPage from "@/app/empresas/page";

async function renderPage(search: Record<string, string> = {}) {
  const ui = await EmpresasPage({ searchParams: Promise.resolve(search) });
  const { container } = render(ui);
  // Each async server sub-component resolves inside Suspense. We let them
  // flush by awaiting a microtask.
  await new Promise((r) => setTimeout(r, 0));
  return container;
}

describe("/empresas page", () => {
  it("renders the SP13 question-framed subtitle", async () => {
    await renderPage();
    expect(
      screen.getByText(/¿Quiénes son, quién importa, quién tiene problemas\?/),
    ).toBeInTheDocument();
  });

  it("invokes all four SP13 queries with default params", async () => {
    getPortfolioKpisMock.mockClear();
    getTopLtvCustomersMock.mockClear();
    getDriftingCompaniesMock.mockClear();
    getCompaniesPageMock.mockClear();
    await renderPage();
    expect(getPortfolioKpisMock).toHaveBeenCalled();
    expect(getTopLtvCustomersMock).toHaveBeenCalledWith(5);
    expect(getDriftingCompaniesMock).toHaveBeenCalledWith(5);
    expect(getCompaniesPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 25,
        sort: "-ltv",
      }),
    );
  });

  it("parses filter searchParams and forwards them to getCompaniesPage", async () => {
    getCompaniesPageMock.mockClear();
    await renderPage({
      type: "cliente",
      tier: "A",
      activity: "activa",
      q: "contitech",
      page: "2",
    });
    expect(getCompaniesPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cliente",
        tier: "A",
        activity: "activa",
        search: "contitech",
        page: 2,
      }),
    );
  });

  it("coerces invalid type via zod to 'all' (not forwarded as filter)", async () => {
    getCompaniesPageMock.mockClear();
    await renderPage({ type: "bogus" });
    const firstCall = getCompaniesPageMock.mock.calls[0];
    const call = (firstCall?.[0] ?? {}) as unknown as Record<string, unknown>;
    expect(call.type).toBeUndefined();
  });
});
