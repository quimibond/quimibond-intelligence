import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { DriftAlert } from "@/components/patterns/drift-alert";

describe("<DriftAlert>", () => {
  it("renders with critical severity styling", () => {
    render(
      <DriftAlert
        severity="critical"
        title="$13.4M timbrados sin booking contable en marzo"
        description="SAT y P&L divergen 45%. Revisar con contabilidad."
      />
    );
    expect(screen.getByText(/\$13\.4M timbrados/)).toBeInTheDocument();
    expect(screen.getByText(/SAT y P&L divergen/)).toBeInTheDocument();
  });

  it("supports an action link", () => {
    render(
      <DriftAlert
        severity="warning"
        title="test"
        description="test"
        action={{ label: "Ver detalles", href: "/sistema/drift" }}
      />
    );
    const link = screen.getByRole("link", { name: "Ver detalles" });
    expect(link).toHaveAttribute("href", "/sistema/drift");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DriftAlert severity="warning" title="t" description="d" />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
