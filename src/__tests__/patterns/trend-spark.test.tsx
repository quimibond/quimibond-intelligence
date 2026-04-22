import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendSpark } from "@/components/patterns/trend-spark";

describe("TrendSpark", () => {
  it("renders a chart with role=img", () => {
    const { container } = render(<TrendSpark values={[1, 2, 3, 4]} ariaLabel="90 días" />);
    expect(container.querySelector('[role="img"]')).toBeTruthy();
  });

  it("uses positive color when trend is up", () => {
    const { container } = render(<TrendSpark values={[1, 2, 3, 4, 5]} ariaLabel="up" />);
    const wrapper = container.querySelector('[data-trend]');
    expect(wrapper?.getAttribute("data-trend")).toBe("up");
  });

  it("uses negative color when trend is down", () => {
    const { container } = render(<TrendSpark values={[5, 4, 3, 2, 1]} ariaLabel="down" />);
    expect(container.querySelector('[data-trend]')?.getAttribute("data-trend")).toBe("down");
  });

  it("uses muted color when trend is flat", () => {
    const { container } = render(<TrendSpark values={[3, 3, 3]} ariaLabel="flat" />);
    expect(container.querySelector('[data-trend]')?.getAttribute("data-trend")).toBe("flat");
  });
});
