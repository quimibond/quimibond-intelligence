import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";

// C8 — monthly DSO proxy for last N months.
//
// Strict DSO requires historical AR snapshots (which we do not have). We use
// a pragmatic monthly proxy: for each month, compute the amount-weighted
// average collection days across all canonical_payment_allocations whose
// payment landed in that month. This matches the "collection velocity" the
// CEO cares about and trends the same way as classical DSO.

export interface DsoMonth {
  period: string; // "YYYY-MM"
  dsoDays: number | null;
  allocatedMxn: number;
  allocationCount: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 7);
}

async function _getDsoTrendRaw(months: number): Promise<DsoMonth[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  // Build the N-month window anchored at the current month.
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)
  );
  const startStr = start.toISOString().slice(0, 10);

  const { data } = await sb
    .from("canonical_payment_allocations")
    .select(
      "allocated_amount, payment_date, invoice_date, invoice_canonical_id, counterparty_canonical_company_id, direction"
    )
    .gte("payment_date", startStr)
    .eq("direction", "received")
    .not("counterparty_canonical_company_id", "in", pgInList(selfIds));

  type Row = {
    allocated_amount: number | null;
    payment_date: string | null;
    invoice_date: string | null;
  };

  const rows = (data ?? []) as Row[];

  // Accumulate weighted sums per month.
  const monthMap = new Map<string, { sumDaysXAmt: number; sumAmt: number; count: number }>();
  for (const r of rows) {
    if (!r.payment_date || !r.invoice_date) continue;
    const amt = Number(r.allocated_amount) || 0;
    if (amt <= 0) continue;
    const days = Math.max(
      0,
      Math.floor(
        (new Date(r.payment_date).getTime() - new Date(r.invoice_date).getTime()) / 86400000
      )
    );
    const period = r.payment_date.slice(0, 7);
    const acc = monthMap.get(period) ?? { sumDaysXAmt: 0, sumAmt: 0, count: 0 };
    acc.sumDaysXAmt += days * amt;
    acc.sumAmt += amt;
    acc.count += 1;
    monthMap.set(period, acc);
  }

  // Emit every month in the window, even empty ones.
  const result: DsoMonth[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1)
    );
    const key = ymd(d);
    const acc = monthMap.get(key);
    const dsoDays = acc && acc.sumAmt > 0 ? Math.round(acc.sumDaysXAmt / acc.sumAmt) : null;
    result.push({
      period: key,
      dsoDays,
      allocatedMxn: acc?.sumAmt ?? 0,
      allocationCount: acc?.count ?? 0,
    });
  }
  return result;
}

export async function getDsoTrend(months = 12): Promise<DsoMonth[]> {
  const cached = unstable_cache(
    () => _getDsoTrendRaw(months),
    ["sp13-cobranza-dso-trend-v1", String(months)],
    { revalidate: 300, tags: ["invoices-unified", "finance"] }
  );
  return cached();
}
