import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinancieroTab } from "@/app/empresas/[id]/_components/FinancieroTab";

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 868,
    canonical_company_id: 868,
    aging: {
      current: 500_000,
      d1_30: 100_000,
      d31_60: 40_000,
      d61_90: 10_000,
      d90_plus: 5_000,
    },
    revenueTrend: [
      { month_start: "2025-06-01", total_mxn: 100_000 },
      { month_start: "2025-07-01", total_mxn: 120_000 },
      { month_start: "2025-08-01", total_mxn: 150_000 },
    ],
    overdue_amount_mxn: 1_200_000,
    lifetime_value_mxn: 847_000_000,
    revenue_90d_mxn: 520_000,
    ...overrides,
  };
}

describe("FinancieroTab", () => {
  it("renders Cartera abierta section with AgingBuckets", () => {
    render(<FinancieroTab detail={makeDetail()} />);
    expect(screen.getByText(/cartera abierta/i)).toBeInTheDocument();
  });

  it("renders 'Ingresos de este cliente' section (not 'P&L')", () => {
    render(<FinancieroTab detail={makeDetail()} />);
    expect(screen.getByText(/ingresos de este cliente/i)).toBeInTheDocument();
    expect(screen.queryByText(/^p&l/i)).toBeNull();
  });

  it("renders Cashflow snapshot MetricRows", () => {
    render(<FinancieroTab detail={makeDetail()} />);
    expect(screen.getByText(/vencida/i)).toBeInTheDocument();
    expect(screen.getByText(/LTV/i)).toBeInTheDocument();
    expect(screen.getByText(/90 días/i)).toBeInTheDocument();
  });
});
