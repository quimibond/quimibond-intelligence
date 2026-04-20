import { getServiceClient } from "@/lib/supabase-server";

export interface CurrencyRateRow {
  currency: string;   // USD, EUR, etc.
  rate: number;       // MXN per 1 unit of foreign currency (e.g. 17.27 means 1 USD = $17.27 MXN)
  rate_date: string;  // ISO date of the quote
}

/**
 * Latest FX rate per currency (most recent quote per currency code).
 * `rate` is MXN-per-foreign-unit as stored by the Odoo sync.
 * Excludes MXN itself (would be 1.0, base currency).
 */
export async function getLatestCurrencyRates(): Promise<CurrencyRateRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_currency_rates")
    .select("currency, rate, rate_date")
    .order("rate_date", { ascending: false })
    .limit(60); // intentional: recent 60 rows, deduped by currency code below
  if (error) throw new Error(`currency_rates query failed: ${error.message}`);

  // Group by currency, take the most recent row per currency code
  const byCurrency = new Map<string, { rate: number; rate_date: string }>();
  for (const row of (data ?? []) as Array<{ currency: string; rate: number; rate_date: string }>) {
    if (!row.currency || row.currency === "MXN") continue;
    if (!byCurrency.has(row.currency)) {
      byCurrency.set(row.currency, { rate: Number(row.rate), rate_date: row.rate_date });
    }
  }

  return Array.from(byCurrency.entries()).map(([currency, v]) => ({
    currency,
    rate: v.rate,
    rate_date: v.rate_date,
  }));
}
