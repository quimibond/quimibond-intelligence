import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/unified/invoices", () => ({
  getOverdueInvoicesPage: vi.fn().mockResolvedValue({
    rows: [
      {
        id: 1,
        name: "INV/2026/03/0173",
        company_id: 101,
        company_name: "Acme SA",
        amount_total_mxn: 100_000,
        amount_residual_mxn: 80_000,
        currency: "MXN",
        days_overdue: 45,
        due_date: "2026-03-08",
        invoice_date: "2026-02-08",
        payment_state: "partial",
        salesperson_name: null,
        uuid_sat: "ABC-DEF-123",
        estado_sat: "vigente",
      },
    ],
    total: 1,
  }),
  getOverdueSalespeopleOptions: vi.fn().mockResolvedValue(["Sandra Davila"]),
}));

vi.mock("@/app/cobranza/_components/OverdueFilterBar", () => ({
  OverdueFilterBar: ({
    params,
    salespeopleOptions,
  }: {
    params: { aging?: string; q?: string; salesperson?: string };
    salespeopleOptions: string[];
  }) => (
    <div data-testid="filter-bar">
      <span data-testid="aging">{params.aging ?? "(no-aging)"}</span>
      <span data-testid="options">{salespeopleOptions.join(",")}</span>
    </div>
  ),
}));

import { OverdueSection } from "@/app/cobranza/_components/OverdueSection";

describe("<OverdueSection />", () => {
  it("translates aging URL value to helper bucket and renders rows", async () => {
    const ui = await OverdueSection({
      params: { aging: "31-60", q: "", salesperson: undefined, page: 1, limit: 50 },
    });
    render(ui);
    const invoices = await import("@/lib/queries/unified/invoices");
    expect(invoices.getOverdueInvoicesPage).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls[0][0];
    expect(callArgs.bucket).toEqual(["31-60"]);
    expect(screen.getByText("INV/2026/03/0173")).toBeInTheDocument();
    expect(screen.getByText("Acme SA")).toBeInTheDocument();
  });

  it('passes "90+" aging through unchanged (helper handles it after Task 1)', async () => {
    const ui = await OverdueSection({
      params: { aging: "90+", q: "", salesperson: undefined, page: 1, limit: 50 },
    });
    render(ui);
    const invoices = await import("@/lib/queries/unified/invoices");
    const callArgs = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls.at(-1)?.[0];
    expect(callArgs?.bucket).toEqual(["90+"]);
  });

  it("does not pass bucket when aging is undefined", async () => {
    const ui = await OverdueSection({
      params: { aging: undefined, q: "", salesperson: undefined, page: 1, limit: 50 },
    });
    render(ui);
    const invoices = await import("@/lib/queries/unified/invoices");
    const callArgs = vi.mocked(invoices.getOverdueInvoicesPage).mock.calls.at(-1)?.[0];
    expect(callArgs?.bucket).toBeUndefined();
  });

  it("forwards salespeople options to OverdueFilterBar", async () => {
    const ui = await OverdueSection({
      params: { aging: undefined, q: "", salesperson: undefined, page: 1, limit: 50 },
    });
    render(ui);
    expect(screen.getByTestId("options")).toHaveTextContent("Sandra Davila");
  });
});
