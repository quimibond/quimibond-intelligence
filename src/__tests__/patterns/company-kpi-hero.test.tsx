import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";

const base = {
  canonical: {
    id: 123,
    display_name: "ACME S.A. DE C.V.",
    rfc: "AAA010101AAA",
    has_shadow_flag: false,
    blacklist_level: "none" as const,
  },
  company360: {
    canonical_company_id: 123,
    lifetime_value_mxn: 12500000,
    revenue_ytd_mxn: 3200000,
    overdue_amount_mxn: 180000,
    open_company_issues_count: 3,
    revenue_90d_mxn: 520000,
  },
  trend: [100, 120, 140, 160, 180],
};

describe("CompanyKpiHero", () => {
  it("renders display_name and rfc", () => {
    render(<CompanyKpiHero {...base} />);
    expect(screen.getByText(/ACME S.A. DE C.V./)).toBeInTheDocument();
    expect(screen.getByText(/AAA010101AAA/)).toBeInTheDocument();
  });

  it("shows 4 KPIs (LTV, YTD, overdue, issues)", () => {
    render(<CompanyKpiHero {...base} />);
    expect(screen.getByText(/LTV/i)).toBeInTheDocument();
    expect(screen.getByText(/YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Vencida/i)).toBeInTheDocument();
    expect(screen.getByText(/Pendientes/i)).toBeInTheDocument();
  });

  it("renders blacklist badge when blacklist_level != none", () => {
    render(<CompanyKpiHero {...base} canonical={{ ...base.canonical, blacklist_level: "69b_definitivo" }} />);
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => b.getAttribute("data-color") === "critical")).toBe(true);
  });

  it("renders shadow badge when has_shadow_flag=true", () => {
    render(<CompanyKpiHero {...base} canonical={{ ...base.canonical, has_shadow_flag: true }} />);
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => /sombra/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("hides overdue block when overdue_amount_mxn is 0", () => {
    render(<CompanyKpiHero {...base} company360={{ ...base.company360, overdue_amount_mxn: 0 }} />);
    const kpis = screen.getAllByRole("figure");
    expect(kpis.some((k) => k.textContent?.includes("$0"))).toBe(true);
  });
});
