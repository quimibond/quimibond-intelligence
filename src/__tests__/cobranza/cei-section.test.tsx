import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/analytics", () => ({
  getCollectionEffectiveness: vi.fn().mockResolvedValue([
    {
      cohort_month: "2025-12-01",
      cohort_age_months: 4,
      invoices_issued: 100,
      customers: 30,
      billed_mxn: 5_000_000,
      collected_mxn: 4_500_000,
      outstanding_mxn: 500_000,
      overdue_30d_mxn: 200_000,
      overdue_90d_mxn: 50_000,
      cei_pct: 90,
      leakage_90d_pct: 1,
      avg_days_to_pay: 35,
      health_status: "healthy" as const,
      cei_delta_vs_prev: 2,
    },
    {
      cohort_month: "2025-11-01",
      cohort_age_months: 5,
      invoices_issued: 80,
      customers: 25,
      billed_mxn: 4_000_000,
      collected_mxn: 2_400_000,
      outstanding_mxn: 1_600_000,
      overdue_30d_mxn: 800_000,
      overdue_90d_mxn: 600_000,
      cei_pct: 60,
      leakage_90d_pct: 15,
      avg_days_to_pay: 78,
      health_status: "degraded" as const,
      cei_delta_vs_prev: -10,
    },
  ]),
}));

import { CeiSection } from "@/app/cobranza/_components/CeiSection";

describe("<CeiSection />", () => {
  it("renders one row per cohort with formatted month + percentage + StatusBadge", async () => {
    const ui = await CeiSection();
    render(ui);
    // Months formatted es-MX short month + 2-digit year
    expect(screen.getByText(/dic\.? 25/i)).toBeInTheDocument();
    expect(screen.getByText(/nov\.? 25/i)).toBeInTheDocument();
    // Percentages
    expect(screen.getByText(/90/)).toBeInTheDocument();
    expect(screen.getByText(/60/)).toBeInTheDocument();
    // StatusBadge labels
    expect(screen.getByText(/Saludable/i)).toBeInTheDocument();
    expect(screen.getByText(/Degradado/i)).toBeInTheDocument();
  });

  it("renders EmptyState when no useful cohorts (all too recent)", async () => {
    const analytics = await import("@/lib/queries/analytics");
    vi.mocked(analytics.getCollectionEffectiveness).mockResolvedValueOnce([
      {
        cohort_month: "2026-04-01",
        cohort_age_months: 0,
        invoices_issued: 10,
        customers: 5,
        billed_mxn: 100_000,
        collected_mxn: 0,
        outstanding_mxn: 100_000,
        overdue_30d_mxn: 0,
        overdue_90d_mxn: 0,
        cei_pct: 0,
        leakage_90d_pct: 0,
        avg_days_to_pay: null,
        health_status: "too_recent" as const,
        cei_delta_vs_prev: null,
      },
    ]);
    const ui = await CeiSection();
    render(ui);
    expect(screen.getByText(/Sin datos de cohort/i)).toBeInTheDocument();
  });
});
