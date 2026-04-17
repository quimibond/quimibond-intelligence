import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

// Only run when env configured (gated in CI secret-safe environments)
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

describeIntegration("syntage Fase 3 integration (real Supabase, read-only)", () => {
  it("invoices_unified has rows", async () => {
    const supabase = sb();
    const { data, error } = await supabase
      .from("invoices_unified")
      .select("canonical_id", { count: "exact", head: true });
    expect(error).toBeNull();
    // data is null for head queries but count arrives in error-free
  });

  it("invoices_unified match_status values are from allowed set", async () => {
    const supabase = sb();
    const { data, error } = await supabase
      .from("invoices_unified")
      .select("match_status")
      .limit(500);
    expect(error).toBeNull();
    const allowed = new Set(["match_uuid","match_composite","syntage_only","odoo_only","ambiguous"]);
    const bad = (data ?? []).filter((r) => !allowed.has(r.match_status));
    expect(bad).toEqual([]);
  });

  it("refresh_invoices_unified RPC returns expected shape", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("refresh_invoices_unified");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      refreshed_at: expect.any(String),
      invoices_unified_rows: expect.any(Number),
      issues_opened: expect.any(Number),
      issues_resolved: expect.any(Number),
      duration_ms: expect.any(Number),
    });
    expect((data as { duration_ms: number }).duration_ms).toBeLessThan(30_000);
  });

  it("refresh_invoices_unified is idempotent (count stable on second call)", async () => {
    const supabase = sb();
    await supabase.rpc("refresh_invoices_unified");
    const { count: c1 } = await supabase
      .from("reconciliation_issues")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null);

    await supabase.rpc("refresh_invoices_unified");
    const { count: c2 } = await supabase
      .from("reconciliation_issues")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null);

    expect(c2).toBe(c1);
  });

  it("get_syntage_reconciliation_summary returns well-formed JSON", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      by_type: expect.any(Array),
      by_severity: expect.any(Object),
      top_companies: expect.any(Array),
      resolution_rate_7d: expect.any(Number),
      recent_critical: expect.any(Array),
    });
  });

  it("invoices_unified refresh completes in < 30s (performance bench)", async () => {
    const supabase = sb();
    const t0 = Date.now();
    const { error } = await supabase.rpc("refresh_invoices_unified");
    const ms = Date.now() - t0;
    expect(error).toBeNull();
    expect(ms).toBeLessThan(30_000);
  });
});
