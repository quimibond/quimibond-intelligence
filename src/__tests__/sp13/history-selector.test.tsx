import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { HistorySelector, parseHistoryRange } from "@/components/patterns/history-selector";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/ventas",
  useSearchParams: () => new URLSearchParams(),
}));

describe("parseHistoryRange", () => {
  it("defaults to 'ltm' when missing", () => {
    expect(parseHistoryRange(undefined)).toBe("ltm");
  });
  it("passes through valid values", () => {
    expect(parseHistoryRange("mtd")).toBe("mtd");
    expect(parseHistoryRange("ytd")).toBe("ytd");
    expect(parseHistoryRange("3y")).toBe("3y");
    expect(parseHistoryRange("5y")).toBe("5y");
    expect(parseHistoryRange("all")).toBe("all");
    expect(parseHistoryRange("ltm")).toBe("ltm");
  });
  it("falls back to 'ltm' on invalid input", () => {
    expect(parseHistoryRange("garbage")).toBe("ltm");
  });
});

describe("<HistorySelector>", () => {
  it("shows the current range label", () => {
    render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    expect(screen.getByRole("button", { name: /últ\. 12 meses/i })).toBeInTheDocument();
  });

  it("pushes the new param on selection", async () => {
    pushMock.mockClear();
    render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByText("Año en curso"));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("rev=ytd"));
  });

  it("has no axe violations", async () => {
    const { container } = render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
