import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { MetricTooltip } from "@/components/patterns/metric-tooltip";

const definition = {
  title: "Ingresos del mes",
  description: "Suma de facturación SAT timbrada con estado vigente del mes actual.",
  formula: "SUM(amount_total_mxn_resolved) WHERE direction='issued' AND estado_sat='vigente' AND month=CURRENT_MONTH",
  table: "canonical_invoices",
};

describe("<MetricTooltip>", () => {
  it("renders the wrapped label", () => {
    render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    expect(screen.getByText("Ingresos del mes")).toBeInTheDocument();
  });

  it("opens the detail panel on click and shows description + formula + table", async () => {
    render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/facturación SAT timbrada/)).toBeInTheDocument();
    expect(screen.getByText(/canonical_invoices/)).toBeInTheDocument();
    expect(screen.getByText(/SUM\(amount_total_mxn_resolved\)/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
