import { getServiceClient } from "@/lib/supabase-server";

/**
 * currency-rates.ts — FX rate queries.
 *
 * canonical_fx_rates is a view over odoo_currency_rates that adds:
 * - is_stale (boolean)
 * - recency_rank (1 = most recent per currency)
 * - inverse_rate
 *
 * This is the canonical source for FX in SP5+.
 */

export interface CurrencyRateRow {
  currency: string; // USD, EUR, etc.
  rate: number; // MXN per 1 unit of foreign currency
  rate_date: string; // ISO date of the quote
  is_stale?: boolean | null;
}

/**
 * Latest FX rate per currency using canonical_fx_rates (recency_rank = 1).
 * Excludes MXN itself (base currency).
 */
export async function fetchLatestFxRates(): Promise<CurrencyRateRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_fx_rates")
    .select("currency, rate, rate_date, is_stale")
    .eq("recency_rank", 1)
    .order("currency");
  if (error) throw new Error(`canonical_fx_rates query failed: ${error.message}`);
  return ((data ?? []) as Array<{
    currency: string;
    rate: number;
    rate_date: string;
    is_stale: boolean | null;
  }>).filter((r) => r.currency && r.currency !== "MXN");
}

/**
 * FX history for a single currency from canonical_fx_rates.
 */
export async function fetchFxHistory(
  currency: string,
  opts: { from?: string; to?: string } = {}
): Promise<{ effective_date: string; rate: number }[]> {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_fx_rates")
    .select("rate_date, rate")
    .eq("currency", currency)
    .order("rate_date");
  if (opts.from) q = q.gte("rate_date", opts.from);
  if (opts.to) q = q.lte("rate_date", opts.to);
  const { data } = await q;
  return ((data ?? []) as Array<{ rate_date: string; rate: number }>).map(
    (r) => ({ effective_date: r.rate_date, rate: Number(r.rate) })
  );
}

/**
 * getLatestCurrencyRates — legacy alias.
 * Previously read odoo_currency_rates directly with manual dedup.
 * Now delegates to fetchLatestFxRates() via canonical_fx_rates.
 */
export async function getLatestCurrencyRates(): Promise<CurrencyRateRow[]> {
  return fetchLatestFxRates();
}
