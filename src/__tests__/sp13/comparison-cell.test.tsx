import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ComparisonCell } from "@/components/patterns/comparison-cell";

describe("<ComparisonCell>", () => {
  it("renders value and delta with up direction", () => {
    render(
      <ComparisonCell
        value={8_314_094}
        comparison={{
          label: "vs mes",
          priorValue: 7_379_304,
          delta: 934_790,
          deltaPct: 12.67,
          direction: "up",
        }}
        format="currency"
      />
    );
    expect(screen.getByText(/8\.[3]M|8,314|8\.3\s*M/)).toBeInTheDocument();
    expect(screen.getByText(/\+12\.7%/)).toBeInTheDocument();
  });

  it("renders em-dash when comparison is null", () => {
    render(<ComparisonCell value={100} comparison={null} format="number" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ComparisonCell value={100} comparison={null} format="number" />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
