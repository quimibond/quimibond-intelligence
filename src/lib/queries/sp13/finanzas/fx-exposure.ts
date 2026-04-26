import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F-FX — Foreign currency exposure.
 *
 * Sources (all gold/canonical, single-FX safe):
 * - canonical_fx_rates (recency_rank=1) → latest USD/EUR rate vs MXN
 * - canonical_invoices (open AR/AP, currency != MXN) → exposure
 *
 * "Exposure" = total open residual in foreign currency. If MXN/USD swings
 * 5%, the implied AR/AP value moves with it, hitting working capital.
 */
export interface FxRateSnapshot {
  currency: string;
  rate: number;
  rateDate: string;
  isStale: boolean;
}

export interface FxExposureRow {
  currency: string;
  direction: "issued" | "received";
  invoiceCount: number;
  amountNative: number;
  amountMxn: number;
}

export interface FxExposureSummary {
  rates: FxRateSnapshot[];
  exposure: FxExposureRow[];
  arForeignMxn: number;
  apForeignMxn: number;
  netForeignMxn: number;
}

async function _getFxExposureRaw(): Promise<FxExposureSummary> {
  const sb = getServiceClient();
  const [ratesRes, openRes] = await Promise.all([
    sb
      .from("canonical_fx_rates")
      .select("currency, rate, rate_date, is_stale")
      .eq("recency_rank", 1)
      .order("currency", { ascending: true }),
    sb
      .from("canonical_invoices")
      .select(
        "currency_odoo, direction, amount_residual_odoo, amount_residual_mxn_odoo"
      )
      .eq("is_quimibond_relevant", true)
      .gt("amount_residual_mxn_odoo", 0)
      .neq("currency_odoo", "MXN"),
  ]);

  const rates: FxRateSnapshot[] = (
    (ratesRes.data ?? []) as Array<{
      currency: string;
      rate: number;
      rate_date: string;
      is_stale: boolean;
    }>
  ).map((r) => ({
    currency: r.currency,
    rate: Number(r.rate) || 0,
    rateDate: r.rate_date,
    isStale: !!r.is_stale,
  }));

  const buckets = new Map<string, FxExposureRow>();
  for (const r of (openRes.data ?? []) as Array<{
    currency_odoo: string | null;
    direction: string | null;
    amount_residual_odoo: number | null;
    amount_residual_mxn_odoo: number | null;
  }>) {
    const cur = r.currency_odoo ?? "—";
    const dir = (r.direction === "received" ? "received" : "issued") as
      | "issued"
      | "received";
    const key = `${cur}|${dir}`;
    const existing =
      buckets.get(key) ??
      ({
        currency: cur,
        direction: dir,
        invoiceCount: 0,
        amountNative: 0,
        amountMxn: 0,
      } as FxExposureRow);
    existing.invoiceCount++;
    existing.amountNative += Number(r.amount_residual_odoo) || 0;
    existing.amountMxn += Number(r.amount_residual_mxn_odoo) || 0;
    buckets.set(key, existing);
  }

  const exposure = [...buckets.values()].sort((a, b) => {
    if (a.currency === b.currency) return a.direction.localeCompare(b.direction);
    return a.currency.localeCompare(b.currency);
  });

  const arForeignMxn = exposure
    .filter((e) => e.direction === "issued")
    .reduce((s, e) => s + e.amountMxn, 0);
  const apForeignMxn = exposure
    .filter((e) => e.direction === "received")
    .reduce((s, e) => s + e.amountMxn, 0);

  return {
    rates,
    exposure,
    arForeignMxn,
    apForeignMxn,
    netForeignMxn: arForeignMxn - apForeignMxn,
  };
}

export const getFxExposure = unstable_cache(
  _getFxExposureRaw,
  ["sp13-finanzas-fx-exposure"],
  { revalidate: 60, tags: ["finanzas"] }
);
