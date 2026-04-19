import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingCard, LoadingTable, LoadingList } from "@/components/patterns/loading";

describe("Loading skeletons", () => {
  it("LoadingCard renders skeleton container", () => {
    const { container } = render(<LoadingCard />);
    expect(container.querySelector('[data-testid="loading-card"]')).toBeInTheDocument();
  });

  it("LoadingTable renders default 5 rows", () => {
    const { container } = render(<LoadingTable />);
    const rows = container.querySelectorAll('[data-testid="loading-table-row"]');
    expect(rows.length).toBe(5);
  });

  it("LoadingTable respects rows prop", () => {
    const { container } = render(<LoadingTable rows={3} />);
    expect(container.querySelectorAll('[data-testid="loading-table-row"]').length).toBe(3);
  });

  it("LoadingList renders default 4 items", () => {
    const { container } = render(<LoadingList />);
    expect(container.querySelectorAll('[data-testid="loading-list-item"]').length).toBe(4);
  });
});
