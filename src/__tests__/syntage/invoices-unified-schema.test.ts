// SP5 T29: invoices_unified MV dropped — schema tests retired.
// Legacy MV removed 2026-04-22. Use canonical_invoices for future schema tests.
import { describe, it } from "vitest";

describe.skip("invoices_unified schema (RETIRED SP5 T29)", () => {
  it("invoices_unified dropped — test retired", () => { /* noop */ });
});
