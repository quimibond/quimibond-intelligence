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

  it("forwards q to listInbox (filter applied SQL-side post-a0824c2)", async () => {
    // Pre-a0824c2 the page filtered JS-side; that loop was removed and the
    // `q` now goes down to the SQL ilike inside listInbox(). The page no
    // longer filters — it just trusts the rows it gets back.
    listInboxMock.mockResolvedValue([
      { ...makeRow("b", "high"), description: "Contitech sin UUID" },
    ]);
    const ui = await InboxPage({
      searchParams: Promise.resolve({ q: "contitech" }),
    });
    render(ui);
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "contitech" }),
    );
    expect(screen.getByText(/Contitech/)).toBeInTheDocument();
  });
});

describe("/inbox page — zod schema for q (commit a0824c2: trim + max 100 + catch)", () => {
  it("trims surrounding whitespace from q before reaching listInbox", async () => {
    listInboxMock.mockResolvedValue([]);
    await InboxPage({
      searchParams: Promise.resolve({ q: "   shawmut   " }),
    });
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "shawmut" }),
    );
  });

  it("rejects q over 100 chars via .catch('') so listInbox receives empty string", async () => {
    listInboxMock.mockResolvedValue([]);
    const long = "x".repeat(101);
    await InboxPage({ searchParams: Promise.resolve({ q: long }) });
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "" }),
    );
  });

  it("accepts q at exactly 100 chars (boundary)", async () => {
    listInboxMock.mockResolvedValue([]);
    const exactly100 = "x".repeat(100);
    await InboxPage({ searchParams: Promise.resolve({ q: exactly100 }) });
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: exactly100 }),
    );
  });

  it("clamps limit to [10, 200] range via zod (catch defaults to 50 on invalid)", async () => {
    listInboxMock.mockResolvedValue([]);
    // limit=999 is above max(200) → catch → fallback to default 50
    await InboxPage({ searchParams: Promise.resolve({ limit: "999" }) });
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("clamps non-numeric limit via zod catch (fallback 50)", async () => {
    listInboxMock.mockResolvedValue([]);
    await InboxPage({ searchParams: Promise.resolve({ limit: "abc" }) });
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });
});
