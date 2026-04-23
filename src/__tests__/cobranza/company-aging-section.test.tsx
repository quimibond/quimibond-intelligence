import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanyAgingSection } from "@/app/cobranza/_components/CompanyAgingSection";

const rows = [
  {
    company_id: 101,
    company_name: "Acme SA",
    tier: "gold",
    current_amount: 50_000,
    overdue_1_30: 30_000,
    overdue_31_60: 20_000,
    overdue_61_90: 10_000,
    overdue_90plus: 5_000,
    total_receivable: 115_000,
    total_revenue: 1_200_000,
  },
  {
    company_id: 102,
    company_name: "Beta SA",
    tier: null,
    current_amount: 0,
    overdue_1_30: 0,
    overdue_31_60: 0,
    overdue_61_90: 0,
    overdue_90plus: 80_000,
    total_receivable: 80_000,
    total_revenue: 600_000,
  },
];

describe("<CompanyAgingSection />", () => {
  it("renders one card per company with link to /empresas/[id]", () => {
    render(<CompanyAgingSection rows={rows} />);
    const link1 = screen.getByRole("link", { name: /Acme SA/i });
    expect(link1).toHaveAttribute("href", "/empresas/101");
    const link2 = screen.getByRole("link", { name: /Beta SA/i });
    expect(link2).toHaveAttribute("href", "/empresas/102");
  });

  it("renders mini AgingBuckets per company", () => {
    render(<CompanyAgingSection rows={rows} />);
    // Two companies → two aging-bar img roles
    const bars = screen.getAllByRole("img", { name: /Aging.*Acme|Aging.*Beta/ });
    expect(bars.length).toBe(2);
  });

  it("shows EmptyState when no rows", () => {
    render(<CompanyAgingSection rows={[]} />);
    expect(screen.getByText(/Sin cartera abierta/i)).toBeInTheDocument();
  });
});
