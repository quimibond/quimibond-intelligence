import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "@/components/patterns/page-layout";

describe("PageLayout", () => {
  it("renders children inside a spaced content wrapper", () => {
    const { container } = render(
      <PageLayout>
        <p>hello</p>
      </PageLayout>
    );
    // PageLayout is a <div>, not a <main> — MainContent owns <main id="main-content">.
    // The outer div carries the canonical spacing + mobile tab-bar clearance.
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.className).toMatch(/space-y-6/);
    expect(wrapper.className).toMatch(/pb-24/);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("accepts className override and merges with defaults", () => {
    const { container } = render(
      <PageLayout className="bg-red-500">
        <p>x</p>
      </PageLayout>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/bg-red-500/);
    expect(wrapper.className).toMatch(/space-y-6/);
  });
});
