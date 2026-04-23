import { describe, expect, it } from "vitest";
import { adaptInboxRow } from "@/lib/queries/intelligence/inbox-adapter";
import type { InboxRow } from "@/lib/queries/intelligence/inbox";

const base: InboxRow = {
  issue_id: "11111111-1111-1111-1111-111111111111",
  issue_type: "invoice.posted_without_uuid",
  severity: "critical",
  priority_score: 87.5,
  impact_mxn: 125000,
  age_days: 4,
  description: "Factura sin UUID",
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-42",
  action_cta: "operationalize",
  assignee_canonical_contact_id: 5,
  assignee_name: "Sandra Davila",
  assignee_email: "sandra@quimibond.com",
  detected_at: "2026-04-18T09:00:00Z",
  invariant_key: null,
  metadata: null,
};

describe("adaptInboxRow", () => {
  it("flattens assignee into nested object when all three fields present", () => {
    const out = adaptInboxRow(base);
    expect(out.issue_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(out.severity).toBe("critical");
    expect(out.priority_score).toBe(87.5);
    expect(out.impact_mxn).toBe(125000);
    expect(out.assignee).toEqual({ id: 5, name: "Sandra Davila", email: "sandra@quimibond.com" });
    expect(out.action_cta).toBe("operationalize");
  });

  it("returns assignee=null when assignee_canonical_contact_id missing", () => {
    const row = { ...base, assignee_canonical_contact_id: null, assignee_name: null, assignee_email: null };
    expect(adaptInboxRow(row).assignee).toBeNull();
  });

  it("returns assignee=null when only id set but name missing", () => {
    const row = { ...base, assignee_name: null };
    expect(adaptInboxRow(row).assignee).toBeNull();
  });

  it("coerces severity to 'low' when null", () => {
    const row = { ...base, severity: null };
    expect(adaptInboxRow(row).severity).toBe("low");
  });

  it("coerces action_cta to null when empty string", () => {
    const row = { ...base, action_cta: "" };
    expect(adaptInboxRow(row).action_cta).toBeNull();
  });

  it("coerces priority_score=null to 0", () => {
    const row = { ...base, priority_score: null };
    expect(adaptInboxRow(row).priority_score).toBe(0);
  });
});
