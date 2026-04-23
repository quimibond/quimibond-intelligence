import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InboxRow } from "@/lib/queries/intelligence/inbox";

const { listInboxMock } = vi.hoisted(() => ({
  listInboxMock: vi.fn<(opts: unknown) => Promise<InboxRow[]>>(),
}));

vi.mock("@/lib/queries/intelligence/inbox", () => ({
  listInbox: listInboxMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));

const makeRow = (issue_id: string, severity: "critical" | "high" | "medium" | "low"): InboxRow => ({
  issue_id,
  issue_type: "invoice.posted_without_uuid",
  severity,
  priority_score: 80,
  impact_mxn: 100000,
  age_days: 2,
  description: `Row ${issue_id}`,
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-1",
  action_cta: "operationalize",
  assignee_canonical_contact_id: 5,
  assignee_name: "Sandra",
  assignee_email: "s@quimibond.com",
  detected_at: "2026-04-20T00:00:00Z",
  invariant_key: null,
  metadata: null,
});

import InboxPage from "@/app/inbox/page";

describe("/inbox page", () => {
  it("calls listInbox with parsed filters and renders one card per row", async () => {
    listInboxMock.mockResolvedValue([makeRow("a", "critical"), makeRow("b", "high")]);
    const ui = await InboxPage({ searchParams: Promise.resolve({ severity: "critical" }) });
    render(ui);
    expect(listInboxMock).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical", limit: 50 }));
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/inbox/insight/a")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/inbox/insight/b")).toBe(true);
  });

  it("coerces invalid severity via zod catch and lists all", async () => {
    listInboxMock.mockResolvedValue([makeRow("a", "critical")]);
    await InboxPage({ searchParams: Promise.resolve({ severity: "bogus" }) });
    expect(listInboxMock).toHaveBeenCalledWith(expect.objectContaining({ severity: undefined }));
  });

  it("filters results by q substring on description (client-side)", async () => {
    listInboxMock.mockResolvedValue([
      { ...makeRow("a", "critical"), description: "ACME vencida" },
      { ...makeRow("b", "high"), description: "Contitech sin UUID" },
    ]);
    const ui = await InboxPage({ searchParams: Promise.resolve({ q: "contitech" }) });
    render(ui);
    expect(screen.getByText(/Contitech/)).toBeInTheDocument();
    expect(screen.queryByText(/ACME/)).toBeNull();
  });
});
