import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "@/components/patterns/section-header";

describe("SectionHeader", () => {
  it("renders title", () => {
    render(<SectionHeader title="Top clientes" />);
    expect(screen.getByRole("heading", { name: "Top clientes" })).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<SectionHeader title="x" description="desc text" />);
    expect(screen.getByText("desc text")).toBeInTheDocument();
  });

  it("renders action slot", () => {
    render(<SectionHeader title="x" action={<button>Click</button>} />);
    expect(screen.getByRole("button", { name: "Click" })).toBeInTheDocument();
  });
});
