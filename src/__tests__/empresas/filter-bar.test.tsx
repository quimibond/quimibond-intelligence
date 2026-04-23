import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompanyFilterBar } from "@/app/empresas/_components/CompanyFilterBar";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/empresas",
}));

describe("CompanyFilterBar", () => {
  const baseProps = {
    params: {
      q: "",
      type: "all" as const,
      blacklist: "any" as const,
      shadowOnly: false,
      sort: "-ltv_mxn" as const,
      page: 1,
      limit: 50,
    },
  };

  it("renders 3 type chips (all/customer/supplier)", () => {
    render(<CompanyFilterBar {...baseProps} />);
    expect(screen.getByRole("button", { name: /todos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clientes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /proveedores/i })).toBeInTheDocument();
  });

  it("clicking 'Clientes' navigates with type=customer", () => {
    pushMock.mockClear();
    render(<CompanyFilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /clientes/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("type=customer"));
  });

  it("search input debounces router.push", async () => {
    pushMock.mockClear();
    render(<CompanyFilterBar {...baseProps} />);
    const input = screen.getByPlaceholderText(/buscar nombre o rfc/i);
    fireEvent.change(input, { target: { value: "contitech" } });
    await waitFor(
      () => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("q=contitech")),
      { timeout: 500 }
    );
  });

  it("shadowOnly toggle navigates with shadowOnly=true", () => {
    pushMock.mockClear();
    render(<CompanyFilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /solo sombra/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("shadowOnly=true"));
  });

  it("renders Clear when any filter active", () => {
    render(<CompanyFilterBar {...baseProps} params={{ ...baseProps.params, type: "customer" }} />);
    expect(screen.getByRole("button", { name: /limpiar/i })).toBeInTheDocument();
  });

  it("does NOT render Clear at defaults", () => {
    render(<CompanyFilterBar {...baseProps} />);
    expect(screen.queryByRole("button", { name: /limpiar/i })).toBeNull();
  });
});
