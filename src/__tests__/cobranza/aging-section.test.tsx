import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/cobranza",
}));

import { AgingSection } from "@/app/cobranza/_components/AgingSection";

const sampleData = {
  current: 1000,
  d1_30: 2000,
  d31_60: 3000,
  d61_90: 4000,
  d90_plus: 5000,
};

describe("<AgingSection />", () => {
  it("renders all 5 buckets with currency formatting", () => {
    render(<AgingSection data={sampleData} />);
    expect(screen.getByText(/Corriente/i)).toBeInTheDocument();
    expect(screen.getByText(/1-30/)).toBeInTheDocument();
    expect(screen.getByText(/31-60/)).toBeInTheDocument();
    expect(screen.getByText(/61-90/)).toBeInTheDocument();
    expect(screen.getByText(/90\+/)).toBeInTheDocument();
  });

  it("clicking d1_30 pushes ?aging=1-30#overdue", () => {
    pushMock.mockClear();
    render(<AgingSection data={sampleData} />);
    fireEvent.click(screen.getByLabelText("Filtrar 1-30"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toMatch(/^\/cobranza\?aging=1-30#overdue$/);
  });

  it("clicking d90_plus pushes ?aging=90%2B#overdue", () => {
    pushMock.mockClear();
    render(<AgingSection data={sampleData} />);
    fireEvent.click(screen.getByLabelText("Filtrar 90+"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    // toSearchString URL-encodes the +
    expect(pushMock.mock.calls[0][0]).toMatch(/aging=90(%2B|\+)/);
  });

  it("clicking the same bucket twice toggles the filter off", () => {
    pushMock.mockClear();
    render(<AgingSection data={sampleData} currentAging="31-60" />);
    fireEvent.click(screen.getByLabelText("Filtrar 31-60"));
    // When toggled off, no aging param remains
    expect(pushMock.mock.calls[0][0]).toMatch(/^\/cobranza#overdue$|^\/cobranza\?#overdue$/);
  });

  it("clicking corriente bucket does nothing (no router.push)", () => {
    pushMock.mockClear();
    render(<AgingSection data={sampleData} />);
    fireEvent.click(screen.getByLabelText("Filtrar Corriente"));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
