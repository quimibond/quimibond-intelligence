import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InboxListClient } from "@/app/inbox/_components/InboxListClient";
// Import from individual file to avoid server-only transitive import via barrel index
// (company-link pulls in _helpers.ts which imports "server-only" — not available in jsdom)
import type { InboxCardIssue } from "@/components/patterns/inbox-card";

const makeIssue = (id: string, severity: InboxCardIssue["severity"] = "critical"): InboxCardIssue => ({
  issue_id: id,
  issue_type: "invoice.posted_without_uuid",
  severity,
  priority_score: 80,
  impact_mxn: 100000,
  age_days: 2,
  description: `Issue ${id}`,
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-1",
  action_cta: "operationalize",
  assignee: null,
  detected_at: "2026-04-20T00:00:00Z",
});

describe("InboxListClient", () => {
  it("renders an empty state when items is empty and no filters", () => {
    render(<InboxListClient items={[]} hasFilters={false} />);
    expect(screen.getByText(/sin alertas pendientes/i)).toBeInTheDocument();
  });

  it("renders a different empty state when filters are applied", () => {
    render(<InboxListClient items={[]} hasFilters={true} />);
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it("renders one linked card per issue", () => {
    render(<InboxListClient items={[makeIssue("a"), makeIssue("b")]} hasFilters={false} />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/inbox/insight/a");
    expect(links[1].getAttribute("href")).toBe("/inbox/insight/b");
  });

  it("wraps the list in a list semantic (SwipeStack role=list)", () => {
    render(<InboxListClient items={[makeIssue("a")]} hasFilters={false} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
