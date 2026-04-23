import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { KpiCard } from "@/components/patterns/kpi-card";
import type { KpiResult } from "@/lib/kpi";

const definition = {
  title: "Ingresos del mes",
  description: "SAT timbrado vigente del mes actual.",
  formula: "SUM(amount_total_mxn_resolved)",
  table: "canonical_invoices",
};

describe("<KpiCard> SP13 extensions", () => {
  it("renders without new props (backwards compat)", () => {
    render(<KpiCard title="Old" value={100} format="number" />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders SourceBadge when `source` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        source="sat"
        definition={definition}
      />
    );
    expect(screen.getByText("SAT")).toBeInTheDocument();
  });

  it("renders MetricTooltip icon when `definition` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        definition={definition}
      />
    );
    expect(
      screen.getByRole("button", { name: /Qué significa: Ingresos del mes/i })
    ).toBeInTheDocument();
  });

  it("renders comparison delta when `comparison` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={110}
        format="number"
        comparison={{
          label: "vs mes",
          priorValue: 100,
          delta: 10,
          deltaPct: 10,
          direction: "up",
        }}
      />
    );
    expect(screen.getByText(/\+10\.0%/)).toBeInTheDocument();
  });

  it("renders DriftPill when multiple `sources` are provided", () => {
    const sources: NonNullable<KpiResult["sources"]> = [
      { source: "sat", value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
      { source: "pl", value: 7_379_304, diffFromPrimary: -934_790, diffPct: -11.2 },
    ];
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        source="sat"
        sources={sources}
        definition={definition}
      />
    );
    expect(screen.getByText(/diff 11\.2%/)).toBeInTheDocument();
  });

  it("has no axe violations with all SP13 props", async () => {
    const { container } = render(
      <KpiCard
        title="Ingresos"
        value={100}
        format="number"
        source="sat"
        definition={definition}
        comparison={{
          label: "vs mes",
          priorValue: 90,
          delta: 10,
          deltaPct: 11.1,
          direction: "up",
        }}
      />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
