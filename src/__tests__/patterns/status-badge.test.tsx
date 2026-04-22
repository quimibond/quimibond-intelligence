import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/patterns/status-badge";

describe("StatusBadge (new API: kind + value)", () => {
  it("renders dot variant by default (density=compact)", () => {
    render(<StatusBadge kind="severity" value="critical" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Severidad crítica");
    expect(el.querySelector('[data-testid="status-dot"]')).toBeTruthy();
    expect(el.textContent).toContain("Severidad crítica");
  });

  it("renders pill variant when density=regular", () => {
    render(<StatusBadge kind="payment" value="paid" density="regular" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-variant", "pill");
    expect(el).toHaveAttribute("data-color", "ok");
  });

  it("returns null for blacklist=none", () => {
    const { container } = render(<StatusBadge kind="blacklist" value="none" />);
    expect(container.firstChild).toBeNull();
  });

  it("supports variant override", () => {
    render(<StatusBadge kind="payment" value="paid" variant="outline" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "outline");
  });

  it("accepts custom ariaLabel override", () => {
    render(<StatusBadge kind="payment" value="paid" ariaLabel="Custom label" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Custom label");
  });
});

describe("StatusBadge (legacy API: status=)", () => {
  it("accepts legacy status= prop and renders as generic pill", () => {
    render(<StatusBadge status="paid" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("Pagada");
    expect(el).toHaveAttribute("data-color", "ok");
  });

  it("falls through unknown status values as-is", () => {
    render(<StatusBadge status="unknown_xyz" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("unknown_xyz");
  });
});

describe("StatusBadge (additional coverage)", () => {
  it("renders leftbar variant when explicitly requested", () => {
    render(<StatusBadge kind="payment" value="paid" variant="leftbar" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-variant", "leftbar");
    expect(el).toHaveAttribute("data-color", "ok");
    expect(el.textContent).toContain("Pagada");
  });

  it("returns null for shadow=false", () => {
    const { container } = render(<StatusBadge kind="shadow" value={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("maps legacy in_payment status to 'En proceso de pago'", () => {
    render(<StatusBadge status="in_payment" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("En proceso de pago");
    expect(el).toHaveAttribute("data-color", "info");
  });
});
