import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { SourceBadge } from "@/components/patterns/source-badge";

describe("<SourceBadge>", () => {
  it("renders short label for each source", () => {
    render(<SourceBadge source="sat" />);
    expect(screen.getByText("SAT")).toBeInTheDocument();
  });

  it("renders a title attribute with the long label for hover", () => {
    render(<SourceBadge source="pl" />);
    const el = screen.getByText("P&L");
    expect(el.closest("[title]")).toHaveAttribute("title", "P&L contable");
  });

  it("applies the source color class", () => {
    const { container } = render(<SourceBadge source="sat" />);
    expect(container.querySelector(".text-primary")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <>
        <SourceBadge source="sat" />
        <SourceBadge source="pl" />
        <SourceBadge source="odoo" />
        <SourceBadge source="canonical" />
      </>
    );
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
