import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { IssueDetailClient, type IssueDetailItem } from "@/app/inbox/insight/[id]/_components/IssueDetailClient";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

const makeItem = (overrides: Partial<IssueDetailItem> = {}): IssueDetailItem => ({
  issue_id: "11111111-1111-1111-1111-111111111111",
  issue_type: "invoice.posted_without_uuid",
  severity: "critical",
  priority_score: 87,
  impact_mxn: 125000,
  age_days: 4,
  description: "Factura sin UUID",
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-42",
  action_cta: "operationalize",
  assignee_canonical_contact_id: 5,
  assignee_name: "Sandra",
  assignee_email: "s@quimibond.com",
  detected_at: "2026-04-18T09:00:00Z",
  invariant_key: null,
  metadata: null,
  email_signals: [],
  ai_extracted_facts: [],
  manual_notes: [],
  attachments: [],
  ...overrides,
});

describe("IssueDetailClient", () => {
  beforeEach(() => {
    pushMock.mockClear();
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders issue header with severity badge and description", () => {
    render(<IssueDetailClient item={makeItem()} />);
    expect(screen.getByText(/factura sin uuid/i)).toBeInTheDocument();
    expect(screen.getAllByRole("status")[0]).toHaveAttribute("data-color", "critical");
  });

  it("primary action label matches action_cta = operationalize", () => {
    const { container } = render(<IssueDetailClient item={makeItem()} />);
    const mobileBar = container.querySelector('[data-testid="mobile-action-bar"]') as HTMLElement;
    expect(within(mobileBar).getByRole("button", { name: /operacionalizar/i })).toBeInTheDocument();
  });

  it("primary action defaults to Resolver when action_cta is null", () => {
    const { container } = render(<IssueDetailClient item={makeItem({ action_cta: null })} />);
    const mobileBar = container.querySelector('[data-testid="mobile-action-bar"]') as HTMLElement;
    expect(within(mobileBar).getByRole("button", { name: /resolver/i })).toBeInTheDocument();
  });

  it("clicking primary action calls correct API endpoint for operationalize", async () => {
    const { container } = render(<IssueDetailClient item={makeItem()} />);
    const mobileBar = container.querySelector('[data-testid="mobile-action-bar"]') as HTMLElement;
    fireEvent.click(within(mobileBar).getByRole("button", { name: /operacionalizar/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/inbox/action/operationalize");
    expect(options.method).toBe("POST");
  });

  it("navigates back to /inbox after successful resolve", async () => {
    const { container } = render(<IssueDetailClient item={makeItem({ action_cta: null })} />);
    const mobileBar = container.querySelector('[data-testid="mobile-action-bar"]') as HTMLElement;
    fireEvent.click(within(mobileBar).getByRole("button", { name: /resolver/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/inbox"));
  });

  it("has a mobile sticky action bar region", () => {
    const { container } = render(<IssueDetailClient item={makeItem()} />);
    const mobileBar = container.querySelector('[data-testid="mobile-action-bar"]');
    expect(mobileBar).not.toBeNull();
    expect(mobileBar).toHaveAttribute("role", "toolbar");
    expect(mobileBar).toHaveAttribute("aria-label", "Acciones");
  });

  it("has a desktop sticky action bar region", () => {
    const { container } = render(<IssueDetailClient item={makeItem()} />);
    const desktopBar = container.querySelector('[data-testid="desktop-action-bar"]');
    expect(desktopBar).not.toBeNull();
    expect(desktopBar).toHaveAttribute("role", "toolbar");
  });
});
