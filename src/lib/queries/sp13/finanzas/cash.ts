import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F1 — Cash snapshot: effective total + credit-card debt.
 * Source: canonical_bank_balances (classification ∈ {cash, debt, other}).
 *
 * Returns totals in MXN. `asOf` is the most recent refreshed_at across rows.
 */
export interface CashKpis {
  efectivoTotalMxn: number;
  deudaTarjetasMxn: number;
  posicionNeta: number;
  cashAccountsCount: number;
  debtAccountsCount: number;
  asOfDate: string | null;
}

async function _getCashKpisRaw(): Promise<CashKpis> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_bank_balances")
    .select("classification, current_balance_mxn, refreshed_at");
  if (error) {
    console.error("[getCashKpis] query failure", error.message);
    return {
      efectivoTotalMxn: 0,
      deudaTarjetasMxn: 0,
      posicionNeta: 0,
      cashAccountsCount: 0,
      debtAccountsCount: 0,
      asOfDate: null,
    };
  }
  type Row = {
    classification: string | null;
    current_balance_mxn: number | null;
    refreshed_at: string | null;
  };
  const rows = (data ?? []) as Row[];
  let cash = 0;
  let debt = 0;
  let cashCount = 0;
  let debtCount = 0;
  let asOf: string | null = null;
  for (const r of rows) {
    const bal = Number(r.current_balance_mxn) || 0;
    if (r.classification === "cash") {
      cash += bal;
      cashCount++;
    } else if (r.classification === "debt") {
      debt += Math.abs(bal);
      debtCount++;
    }
    if (r.refreshed_at && (!asOf || r.refreshed_at > asOf)) asOf = r.refreshed_at;
  }
  return {
    efectivoTotalMxn: cash,
    deudaTarjetasMxn: debt,
    posicionNeta: cash - debt,
    cashAccountsCount: cashCount,
    debtAccountsCount: debtCount,
    asOfDate: asOf,
  };
}

export const getCashKpis = unstable_cache(
  _getCashKpisRaw,
  ["sp13-finanzas-cash-kpis"],
  { revalidate: 60, tags: ["finanzas"] }
);
