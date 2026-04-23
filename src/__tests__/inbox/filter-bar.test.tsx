import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InboxFilterBar } from "@/app/inbox/_components/InboxFilterBar";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));

describe("InboxFilterBar", () => {
  const baseProps = {
    params: { severity: undefined, entity: undefined, assignee: undefined, q: "", limit: 50 },
    counts: { critical: 3, high: 7, medium: 12, low: 4 },
    assigneeOptions: [
      { id: 5, name: "Sandra Davila" },
      { id: 7, name: "Guadalupe Guerrero" },
    ],
  };

  it("renders 4 severity chips with counts", () => {
    render(<InboxFilterBar {...baseProps} />);
    expect(screen.getByRole("button", { name: /critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /high/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /low/i })).toBeInTheDocument();
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(7\)/)).toBeInTheDocument();
  });

  it("clicking a severity chip navigates with that severity param", () => {
    pushMock.mockClear();
    render(<InboxFilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("severity=critical"));
  });

  it("clicking the active severity chip unsets it", () => {
    pushMock.mockClear();
    render(<InboxFilterBar {...baseProps} params={{ ...baseProps.params, severity: "critical" }} />);
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    const lastCall = pushMock.mock.calls[pushMock.mock.calls.length - 1][0] as string;
    expect(lastCall).not.toMatch(/severity=/);
  });

  it("search input debounces router.push", async () => {
    pushMock.mockClear();
    render(<InboxFilterBar {...baseProps} />);
    const input = screen.getByPlaceholderText(/buscar/i);
    fireEvent.change(input, { target: { value: "contitech" } });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("q=contitech")), { timeout: 500 });
  });

  it("renders a Clear button when any filter is active", () => {
    render(<InboxFilterBar {...baseProps} params={{ ...baseProps.params, severity: "high" }} />);
    expect(screen.getByRole("button", { name: /limpiar/i })).toBeInTheDocument();
  });

  it("does not render Clear button when no filters active", () => {
    render(<InboxFilterBar {...baseProps} />);
    expect(screen.queryByRole("button", { name: /limpiar/i })).toBeNull();
  });
});
