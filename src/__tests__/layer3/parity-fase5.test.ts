// SP5 T29: invoices_unified MV dropped — parity tests retired.
// Legacy MV removed 2026-04-22. Use canonical_invoices for future parity checks.
import { describe, it } from "vitest";

describe.skip("Fase 5 parity · legacy vs unified (RETIRED SP5 T29)", () => {
  it("invoices_unified dropped — test retired", () => { /* noop */ });
});
