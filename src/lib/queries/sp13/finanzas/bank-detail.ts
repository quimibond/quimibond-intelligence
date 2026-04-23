import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F7 (detail) — Detalle por cuenta bancaria:
 *   banco, saldo, cambio vs ayer, última transacción, badge stale.
 *
 * La tabla canonical_bank_balances no guarda histórico; cambio vs ayer = diff
 * vs. last payment/outgoing observado en canonical_payments del día anterior.
 */
export interface BankAccountDetail {
  journalId: number | null;
  name: string | null;
  bankAccount: string | null;
  journalType: string | null;
  classification: string | null;
  currency: string | null;
  currentBalance: number;
  currentBalanceMxn: number;
  lastActivityAt: string | null;
  isStale: boolean;
  changeVs24h: number | null;
}

async function _getBankDetailRaw(): Promise<BankAccountDetail[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_bank_balances")
    .select(
      "odoo_journal_id, name, journal_type, classification, currency, bank_account, current_balance, current_balance_mxn, updated_at, is_stale, refreshed_at"
    )
    .order("current_balance_mxn", { ascending: false });
  if (error) {
    console.error("[getBankDetail] query failure", error.message);
    return [];
  }
  type Row = {
    odoo_journal_id: number | null;
    name: string | null;
    journal_type: string | null;
    classification: string | null;
    currency: string | null;
    bank_account: string | null;
    current_balance: number | null;
    current_balance_mxn: number | null;
    updated_at: string | null;
    is_stale: boolean | null;
    refreshed_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Aggregate payments by journal for last-24h delta
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: paymentsData } = await sb
    .from("canonical_payments")
    .select("odoo_journal_id, direction, amount_mxn_resolved, amount_mxn_odoo, payment_date_resolved")
    .gte("payment_date_resolved", since);
  type Pay = {
    odoo_journal_id: number | null;
    direction: string | null;
    amount_mxn_resolved: number | null;
    amount_mxn_odoo: number | null;
  };
  const deltaByJournal = new Map<number, number>();
  for (const p of (paymentsData ?? []) as Pay[]) {
    if (p.odoo_journal_id == null) continue;
    const amt = Number(p.amount_mxn_resolved ?? p.amount_mxn_odoo) || 0;
    const signed = p.direction === "received" ? amt : -amt;
    deltaByJournal.set(
      p.odoo_journal_id,
      (deltaByJournal.get(p.odoo_journal_id) ?? 0) + signed
    );
  }

  return rows.map((r) => ({
    journalId: r.odoo_journal_id,
    name: r.name,
    bankAccount: r.bank_account,
    journalType: r.journal_type,
    classification: r.classification,
    currency: r.currency,
    currentBalance: Number(r.current_balance) || 0,
    currentBalanceMxn: Number(r.current_balance_mxn) || 0,
    lastActivityAt: r.updated_at,
    isStale: !!r.is_stale,
    changeVs24h:
      r.odoo_journal_id != null ? deltaByJournal.get(r.odoo_journal_id) ?? 0 : null,
  }));
}

export const getBankDetail = unstable_cache(
  _getBankDetailRaw,
  ["sp13-finanzas-bank-detail"],
  { revalidate: 60, tags: ["finanzas"] }
);
