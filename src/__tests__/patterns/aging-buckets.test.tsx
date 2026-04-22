import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgingBuckets, type AgingData } from "@/components/patterns/aging-buckets";

const data: AgingData = {
  current:   500000,
  d1_30:     150000,
  d31_60:    80000,
  d61_90:    40000,
  d90_plus:  25000,
};

describe("AgingBuckets", () => {
  it("renders with role=img and summary in aria-label", () => {
    render(<AgingBuckets data={data} ariaLabel="Aging de cartera" />);
    const el = screen.getByRole("img");
    expect(el).toHaveAttribute("aria-label", "Aging de cartera");
  });

  it("renders a legend with 5 buckets", () => {
    render(<AgingBuckets data={data} ariaLabel="x" showLegend />);
    expect(screen.getByText(/Corriente/i)).toBeInTheDocument();
    expect(screen.getByText(/1\s?-\s?30/i)).toBeInTheDocument();
    expect(screen.getByText(/31\s?-\s?60/i)).toBeInTheDocument();
    expect(screen.getByText(/61\s?-\s?90/i)).toBeInTheDocument();
    expect(screen.getByText(/90\+/i)).toBeInTheDocument();
  });

  it("fires onBucketClick with bucket key", () => {
    const cb = vi.fn();
    render(<AgingBuckets data={data} ariaLabel="x" onBucketClick={cb} />);
    const button = screen.getByRole("button", { name: /Corriente/i });
    fireEvent.click(button);
    expect(cb).toHaveBeenCalledWith("current");
  });
});
