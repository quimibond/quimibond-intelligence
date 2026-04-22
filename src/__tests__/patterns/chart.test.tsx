import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chart } from "@/components/patterns/chart";

const sample = [
  { month: "Jan", revenue: 100, expenses: 60 },
  { month: "Feb", revenue: 140, expenses: 70 },
  { month: "Mar", revenue: 180, expenses: 90 },
];

describe("Chart", () => {
  it("requires ariaLabel and exposes it with role=img", () => {
    render(
      <Chart
        type="line"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos" }]}
        ariaLabel="Ingresos mensuales"
      />
    );
    const el = screen.getByRole("img");
    expect(el).toHaveAttribute("aria-label", "Ingresos mensuales");
  });

  it("renders screen-reader data table adjacent to chart", () => {
    const { container } = render(
      <Chart
        type="bar"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos" }]}
        ariaLabel="Revenue chart"
      />
    );
    const srTable = container.querySelector('table.sr-only');
    expect(srTable).toBeTruthy();
    expect(srTable?.textContent).toContain("Jan");
    expect(srTable?.textContent).toContain("100");
  });

  it("sparkline type hides axes and tooltips", () => {
    const { container } = render(
      <Chart
        type="sparkline"
        data={[{ t: 1, v: 10 }, { t: 2, v: 20 }, { t: 3, v: 15 }]}
        xKey="t"
        series={[{ key: "v", label: "v" }]}
        ariaLabel="Trend"
      />
    );
    expect(container.querySelector(".recharts-cartesian-axis")).toBeFalsy();
  });

  it("accepts semantic colors on series", () => {
    const { container } = render(
      <Chart
        type="area"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos", color: "positive" }]}
        ariaLabel="Revenue"
      />
    );
    expect(container.querySelector('[role="img"]')).toBeTruthy();
  });
});
