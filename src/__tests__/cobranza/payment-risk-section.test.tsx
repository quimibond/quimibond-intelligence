import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock the batch-actions wrapper. We assert it received an idToName map.
let lastIdToName: Record<string, string> | undefined;
vi.mock("@/app/cobranza/_components/payment-risk-batch-actions", () => ({
  PaymentRiskBatchActions: ({
    idToName,
  }: {
    idToName: Record<string, string>;
  }) => {
    lastIdToName = idToName;
    return <div data-testid="batch-bar">batch-mounted</div>;
  },
}));

import { PaymentRiskSection } from "@/app/cobranza/_components/PaymentRiskSection";

const rows = [
  {
    company_id: 11,
    company_name: "Acme SA",
    tier: "gold",
    payment_risk: "critical",
    payment_trend: "deteriorating",
    avg_days_to_pay: 75,
    median_days_to_pay: 70,
    max_days_overdue: 120,
    total_pending: 320_000,
    pending_count: 4,
    predicted_payment_date: null,
  },
  {
    company_id: 12,
    company_name: "Beta Corp",
    tier: "silver",
    payment_risk: "abnormal",
    payment_trend: "stable",
    avg_days_to_pay: 50,
    median_days_to_pay: 48,
    max_days_overdue: 35,
    total_pending: 110_000,
    pending_count: 2,
    predicted_payment_date: null,
  },
];

describe("<PaymentRiskSection />", () => {
  it("renders one card per row with checkbox and batch bar mounted", () => {
    render(<PaymentRiskSection rows={rows} />);
    expect(screen.getByText("Acme SA")).toBeInTheDocument();
    expect(screen.getByText("Beta Corp")).toBeInTheDocument();
    // Two RowCheckbox a11y labels:
    expect(screen.getByLabelText("Seleccionar Acme SA")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Seleccionar Beta Corp")
    ).toBeInTheDocument();
    // BatchActions is always mounted (it self-hides on count===0):
    expect(screen.getByTestId("batch-bar")).toBeInTheDocument();
  });

  it("passes a stable idToName map keyed by stringified company_id", () => {
    render(<PaymentRiskSection rows={rows} />);
    expect(lastIdToName).toEqual({ "11": "Acme SA", "12": "Beta Corp" });
  });

  it("shows EmptyState when rows is empty", () => {
    render(<PaymentRiskSection rows={[]} />);
    expect(
      screen.getByText(/Sin clientes con patrón anormal/i)
    ).toBeInTheDocument();
    // No batch-bar when empty (early return path)
    expect(screen.queryByTestId("batch-bar")).toBeNull();
  });
});
