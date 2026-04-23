import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/cobranza",
}));

import { OverdueFilterBar } from "@/app/cobranza/_components/OverdueFilterBar";

describe("<OverdueFilterBar />", () => {
  it("renders aging chip when params.aging is set, with remove button", () => {
    pushMock.mockClear();
    render(
      <OverdueFilterBar
        params={{ aging: "31-60", q: "", salesperson: undefined }}
        salespeopleOptions={[]}
      />
    );
    expect(screen.getByText(/31-60/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Quitar filtro de aging/i));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).not.toMatch(/aging=/);
  });

  it("does not render aging chip when params.aging is undefined", () => {
    render(
      <OverdueFilterBar
        params={{ aging: undefined, q: "", salesperson: undefined }}
        salespeopleOptions={[]}
      />
    );
    expect(screen.queryByLabelText(/Quitar filtro de aging/i)).toBeNull();
  });

  it("debounces search input — only pushes once after 300ms", async () => {
    vi.useFakeTimers();
    pushMock.mockClear();
    render(
      <OverdueFilterBar
        params={{ aging: undefined, q: "", salesperson: undefined }}
        salespeopleOptions={[]}
      />
    );
    const input = screen.getByPlaceholderText(/Buscar/i);
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ac" } });
    fireEvent.change(input, { target: { value: "acm" } });
    fireEvent.change(input, { target: { value: "acme" } });
    expect(pushMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toMatch(/q=acme/);
    vi.useRealTimers();
  });

  it("renders salesperson dropdown with provided options", () => {
    render(
      <OverdueFilterBar
        params={{ aging: undefined, q: "", salesperson: undefined }}
        salespeopleOptions={["Ana López", "Sandra Davila"]}
      />
    );
    // Trigger button or select element should exist
    const trigger = screen.getByRole("combobox", { name: /vendedor/i });
    expect(trigger).toBeInTheDocument();
  });
});
