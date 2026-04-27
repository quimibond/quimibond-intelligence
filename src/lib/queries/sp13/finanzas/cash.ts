import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F1 — Cash snapshot: efectivo total + deuda tarjetas.
 *
 * Source autoritativa: `gold_cashflow` (view oficial sobre canonical_bank_balances).
 * Antes leía canonical_bank_balances directo, lo que creaba un camino paralelo
 * Hero↔gold con riesgo de drift si gold cambiaba su definición. Ver audit
 * Supabase+Frontend 2026-04-27, Issue #5 (top 5 estructura).
 *
 * `asOfDate` se obtiene de canonical_bank_balances.refreshed_at MAX porque
 * gold_cashflow.refreshed_at es now() at query time (no refleja staleness real).
 * `cashAccountsCount` / `debtAccountsCount` vienen del bank_breakdown jsonb
 * que gold_cashflow ya agrega.
 */
export interface CashKpis {
  efectivoTotalMxn: number;
  deudaTarjetasMxn: number;
  posicionNeta: number;
  cashAccountsCount: number;
  debtAccountsCount: number;
  asOfDate: string | null;
}

type GoldCashflow = {
  current_cash_mxn: number | null;
  current_debt_mxn: number | null;
  bank_breakdown: Array<{
    classification: string | null;
    total_mxn: number | null;
    journals: number | null;
  }> | null;
};

async function _getCashKpisRaw(): Promise<CashKpis> {
  const sb = getServiceClient();
  const [goldRes, asOfRes] = await Promise.all([
    sb
      .from("gold_cashflow")
      .select("current_cash_mxn, current_debt_mxn, bank_breakdown")
      .maybeSingle(),
    sb
      .from("canonical_bank_balances")
      .select("refreshed_at")
      .order("refreshed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (goldRes.error) {
    console.error("[getCashKpis] gold_cashflow query failure", goldRes.error.message);
    return {
      efectivoTotalMxn: 0,
      deudaTarjetasMxn: 0,
      posicionNeta: 0,
      cashAccountsCount: 0,
      debtAccountsCount: 0,
      asOfDate: null,
    };
  }

  const cf = (goldRes.data ?? null) as GoldCashflow | null;
  const cash = Number(cf?.current_cash_mxn) || 0;
  const debt = Math.abs(Number(cf?.current_debt_mxn) || 0);

  let cashCount = 0;
  let debtCount = 0;
  for (const b of cf?.bank_breakdown ?? []) {
    const journals = Number(b?.journals) || 0;
    if (b?.classification === "cash") cashCount += journals;
    else if (b?.classification === "debt") debtCount += journals;
  }

  const asOf =
    (asOfRes.data as { refreshed_at: string | null } | null)?.refreshed_at ?? null;

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
  ["sp13-finanzas-cash-kpis-v2-gold"],
  { revalidate: 60, tags: ["finanzas"] }
);
