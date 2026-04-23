import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompanyListClient, type CompanyListRow } from "@/app/empresas/_components/CompanyListClient";

const makeRow = (id: number, overrides: Partial<CompanyListRow> = {}): CompanyListRow => ({
  canonical_company_id: id,
  display_name: `Empresa ${id}`,
  rfc: `AAA010101X${id}`,
  is_customer: true,
  is_supplier: false,
  has_shadow_flag: false,
  blacklist_level: "none",
  lifetime_value_mxn: 1_000_000,
  revenue_ytd_mxn: 250_000,
  overdue_amount_mxn: 0,
  open_company_issues_count: 0,
  ...overrides,
});

describe("CompanyListClient", () => {
  it("renders an empty state when items is empty and no filters", () => {
    render(<CompanyListClient items={[]} hasFilters={false} />);
    expect(screen.getByText(/sin empresas/i)).toBeInTheDocument();
  });

  it("renders a different empty state when filters are applied", () => {
    render(<CompanyListClient items={[]} hasFilters={true} />);
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it("renders one linked row per company (mobile card or desktop row)", () => {
    render(
      <CompanyListClient
        items={[makeRow(1), makeRow(2, { display_name: "Empresa 2" })]}
        hasFilters={false}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/empresas/1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/empresas/2")).toBe(true);
  });

  it("renders blacklist badge when blacklist_level != none", () => {
    render(
      <CompanyListClient
        items={[makeRow(1, { blacklist_level: "69b_definitivo" })]}
        hasFilters={false}
      />
    );
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => b.getAttribute("data-color") === "critical")).toBe(true);
  });

  it("renders shadow badge when has_shadow_flag=true", () => {
    render(
      <CompanyListClient
        items={[makeRow(1, { has_shadow_flag: true })]}
        hasFilters={false}
      />
    );
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => /sombra/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("displays formatted MXN values", () => {
    render(
      <CompanyListClient
        items={[makeRow(1, { lifetime_value_mxn: 45_000_000 })]}
        hasFilters={false}
      />
    );
    expect(screen.getByText(/\$45,000,000/)).toBeInTheDocument();
  });
});
