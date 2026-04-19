import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "@/components/patterns/page-layout";

describe("PageLayout", () => {
  it("renders children inside a main element with spacing", () => {
    render(
      <PageLayout>
        <p>hello</p>
      </PageLayout>
    );
    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main.className).toMatch(/max-w-7xl/);
    expect(main.className).toMatch(/space-y-6/);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("accepts className override and merges with defaults", () => {
    render(
      <PageLayout className="bg-red-500">
        <p>x</p>
      </PageLayout>
    );
    const main = screen.getByRole("main");
    expect(main.className).toMatch(/bg-red-500/);
    expect(main.className).toMatch(/max-w-7xl/);
  });
});
