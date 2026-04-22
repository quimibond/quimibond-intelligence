import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InboxCard, type InboxCardIssue } from "@/components/patterns/inbox-card";

const issue: InboxCardIssue = {
  issue_id: "abc-123",
  issue_type: "invoice.posted_without_uuid",
  severity: "critical",
  priority_score: 87.5,
  impact_mxn: 125000,
  age_days: 4,
  description: "Factura INV/2026/03/0173 sin UUID timbrado",
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-42",
  action_cta: "operationalize",
  assignee: { id: 5, name: "Sandra Davila", email: "sandra@quimibond.com" },
  detected_at: "2026-04-18T09:00:00Z",
};

describe("InboxCard", () => {
  it("renders the core fields with a11y roles", () => {
    render(<InboxCard issue={issue} />);
    expect(screen.getByRole("article")).toBeInTheDocument();
    expect(screen.getByText(issue.description)).toBeInTheDocument();
    expect(screen.getByText(/Sandra Davila/)).toBeInTheDocument();
  });

  it("shows severity via StatusBadge", () => {
    render(<InboxCard issue={issue} />);
    const badge = screen.getAllByRole("status").find((el) => el.getAttribute("data-color") === "critical");
    expect(badge).toBeTruthy();
  });

  it("shows age_days and priority score", () => {
    render(<InboxCard issue={issue} />);
    expect(screen.getByText(/4.*d/)).toBeInTheDocument();
    expect(screen.getByText(/87/)).toBeInTheDocument();
  });

  it("renders action CTA button with aria-label when action_cta is set", () => {
    const onAction = vi.fn();
    render(<InboxCard issue={issue} onAction={onAction} />);
    const btn = screen.getByRole("button", { name: /Operacionalizar/i });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith("operationalize", issue);
  });

  it("renders without assignee section when assignee is null", () => {
    const noAssignee = { ...issue, assignee: null };
    render(<InboxCard issue={noAssignee} />);
    expect(screen.queryByText(/Sandra Davila/)).toBeNull();
  });

  it("button has min 44px tap target (mobile)", () => {
    render(<InboxCard issue={issue} onAction={() => {}} />);
    const btn = screen.getByRole("button", { name: /Operacionalizar/i });
    expect(btn.className).toMatch(/min-h-\[44px\]|h-11/);
  });
});
