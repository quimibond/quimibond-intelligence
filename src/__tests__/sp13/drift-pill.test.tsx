import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { DriftPill } from "@/components/patterns/drift-pill";

const sources = [
  { source: "sat" as const, value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
  { source: "pl" as const, value: 7_379_304, diffFromPrimary: -934_790, diffPct: -11.2 },
];

describe("<DriftPill>", () => {
  it("shows severity label based on max absolute diffPct", () => {
    render(<DriftPill sources={sources} primary="sat" />);
    expect(screen.getByRole("button")).toHaveTextContent(/diff/i);
  });

  it("opens a popover with the source breakdown on click", async () => {
    render(<DriftPill sources={sources} primary="sat" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/P&L/)).toBeInTheDocument();
    expect(screen.getByText(/-11\.2%/)).toBeInTheDocument();
  });

  it("returns null when there are fewer than 2 sources", () => {
    const { container } = render(
      <DriftPill sources={[sources[0]]} primary="sat" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<DriftPill sources={sources} primary="sat" />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
