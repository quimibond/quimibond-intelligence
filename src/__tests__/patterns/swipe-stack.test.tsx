import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwipeStack } from "@/components/patterns/swipe-stack";

describe("SwipeStack", () => {
  it("renders children in scroll-snap container with mobile snap rules", () => {
    const { container } = render(
      <SwipeStack ariaLabel="Inbox">
        <div data-testid="item-1">1</div>
        <div data-testid="item-2">2</div>
      </SwipeStack>
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute("aria-label", "Inbox");
    expect(root.className).toMatch(/snap-y|scroll-snap/);
    expect(screen.getByTestId("item-1")).toBeInTheDocument();
  });

  it("wraps each child in a snap-center node", () => {
    const { container } = render(
      <SwipeStack ariaLabel="x">
        <span>a</span>
        <span>b</span>
      </SwipeStack>
    );
    const items = container.querySelectorAll('[data-swipe-item]');
    expect(items.length).toBe(2);
  });
});
