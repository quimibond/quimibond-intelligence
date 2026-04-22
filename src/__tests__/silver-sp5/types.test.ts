import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/database.types";

type CanonicalInvoice = Database["public"]["Tables"]["canonical_invoices"]["Row"];
type GoldCeoInboxRow = Database["public"]["Views"]["gold_ceo_inbox"]["Row"];

describe("silver-sp5 types", () => {
  it("Database type exposes canonical_invoices", () => {
    const stub: Pick<CanonicalInvoice, "canonical_id" | "direction" | "amount_total_mxn_resolved"> = {
      canonical_id: "x",
      direction: "issued",
      amount_total_mxn_resolved: 100,
    };
    expect(stub.canonical_id).toBe("x");
    expect(stub.direction).toBe("issued");
  });

  it("Database type exposes gold_ceo_inbox view", () => {
    const stub: Pick<GoldCeoInboxRow, "issue_id" | "severity" | "priority_score"> = {
      issue_id: "00000000-0000-0000-0000-000000000000",
      severity: "critical",
      priority_score: 100,
    };
    expect(stub.severity).toBe("critical");
  });
});
