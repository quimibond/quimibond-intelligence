import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../../_shared/_helpers";

// C8 — monthly DSO proxy for last N months.
//
// Strict DSO requires historical AR snapshots (which we do not have). We use
// a pragmatic monthly proxy: for each month, compute the amount-weighted
// average collection days across all canonical_invoices that became fully
// paid in that month. We pick the payment date from
// `fiscal_fully_paid_at` (SAT, when present) and fall back to
// `payment_date_odoo` (Odoo write_date proxy) so coverage is high.

export interface DsoMonth {
  period: string; // "YYYY-MM"
  dsoDays: number | null;
  paidMxn: number;
  paidCount: number;
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

  // Pull issued, non-cancelled invoices that became fully paid in window.
  // We OR over fiscal_fully_paid_at + payment_date_odoo so the row is
  // included if either source places its payment inside the window.
  const { data } = await sb
    .from("canonical_invoices")
    .select(
      "invoice_date, fiscal_fully_paid_at, payment_date_odoo, amount_total_mxn_resolved, amount_total_mxn_odoo, receptor_canonical_company_id"
    )
    .eq("direction", "issued")
    .neq("estado_sat", "cancelado")
    .eq("payment_state_odoo", "paid")
    .or(
      `fiscal_fully_paid_at.gte.${startStr},payment_date_odoo.gte.${startStr}`
    )
    .not("receptor_canonical_company_id", "in", pgInList(selfIds));

  type Row = {
    invoice_date: string | null;
    fiscal_fully_paid_at: string | null;
    payment_date_odoo: string | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };

  const rows = (data ?? []) as Row[];

  // Bucket by month of payment.
  const monthMap = new Map<
    string,
    { sumDaysXAmt: number; sumAmt: number; count: number }
  >();
  for (const r of rows) {
    const paid = r.fiscal_fully_paid_at ?? r.payment_date_odoo;
    if (!paid || !r.invoice_date) continue;
    if (paid < startStr) continue;
    const amt =
      Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0;
    if (amt <= 0) continue;
    const days = Math.max(
      0,
      Math.floor(
        (new Date(paid).getTime() - new Date(r.invoice_date).getTime()) /
          86400000
      )
    );
    const period = paid.slice(0, 7);
    const acc =
      monthMap.get(period) ?? { sumDaysXAmt: 0, sumAmt: 0, count: 0 };
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
    const dsoDays =
      acc && acc.sumAmt > 0 ? Math.round(acc.sumDaysXAmt / acc.sumAmt) : null;
    result.push({
      period: key,
      dsoDays,
      paidMxn: acc?.sumAmt ?? 0,
      paidCount: acc?.count ?? 0,
    });
  }
  return result;
}

export async function getDsoTrend(months = 12): Promise<DsoMonth[]> {
  const cached = unstable_cache(
    () => _getDsoTrendRaw(months),
    ["sp13-cobranza-dso-trend-v2", String(months)],
    { revalidate: 300, tags: ["invoices-unified", "finance"] }
  );
  return cached();
}
