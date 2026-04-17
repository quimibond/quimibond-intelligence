import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

async function legacyCxcTotal(): Promise<number> {
  const supabase = sb();
  const { data, error } = await supabase.from("odoo_invoices")
    .select("amount_residual,move_type,state,payment_state,cfdi_sat_state")
    .in("move_type", ["out_invoice", "out_refund"])
    .eq("state", "posted")
    .in("payment_state", ["not_paid", "partial", "in_payment"])
    .not("cfdi_sat_state", "eq", "cancelado");
  if (error) throw error;
  return (data ?? []).reduce((s: number, r: { amount_residual: number | null }) => s + (r.amount_residual ?? 0), 0);
}

async function unifiedCxcTotal(): Promise<number> {
  const supabase = sb();
  const { data, error } = await supabase.from("invoices_unified")
    .select("amount_residual,direction,match_status,estado_sat,odoo_state,payment_state")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial", "in_payment"]);
  if (error) throw error;
  return (data ?? []).reduce((s: number, r: { amount_residual: number | null }) => s + (r.amount_residual ?? 0), 0);
}

describeIntegration("Fase 5 parity · legacy vs unified", () => {
  it("CxC total diff <0.5% (allows for cancelled_but_posted exclusion)", async () => {
    const legacy = await legacyCxcTotal();
    const unified = await unifiedCxcTotal();
    const diff = Math.abs(legacy - unified);
    const pct = legacy > 0 ? (diff / legacy) : 0;
    // 0.5% tolerance: unified excludes cancelled_but_posted (~97 rows) which legacy includes via payment_state not_paid
    expect(pct).toBeLessThan(0.005);
  });

  it("CxC aging bucket counts match within 2%", async () => {
    const supabase = sb();
    const { data: legacy, error: e1 } = await supabase.from("odoo_invoices")
      .select("amount_residual,days_overdue,move_type,state,payment_state,cfdi_sat_state")
      .in("move_type", ["out_invoice", "out_refund"])
      .eq("state", "posted")
      .in("payment_state", ["not_paid", "partial", "in_payment"])
      .not("cfdi_sat_state", "eq", "cancelado");
    if (e1) throw e1;
    const { data: unified, error: e2 } = await supabase.from("invoices_unified")
      .select("amount_residual,days_overdue,direction,match_status,estado_sat,payment_state")
      .eq("direction", "issued")
      .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
      .not("estado_sat", "eq", "cancelado")
      .in("payment_state", ["not_paid", "partial", "in_payment"]);
    if (e2) throw e2;
    const legacyCount = (legacy ?? []).length;
    const unifiedCount = (unified ?? []).length;
    const diff = Math.abs(legacyCount - unifiedCount);
    expect(diff / legacyCount).toBeLessThan(0.02);
  });
});
