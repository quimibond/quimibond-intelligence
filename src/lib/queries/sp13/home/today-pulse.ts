import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Today's operational pulse — what happened TODAY vs YESTERDAY.
 *
 * Sources:
 *  - sales        → canonical_invoices (direction=issued, out_invoice posted/null, vigente)
 *  - collections  → odoo_account_payments (payment_type=inbound, state=posted) — más fresco que canonical_payments
 *  - payments     → odoo_account_payments (payment_type=outbound, state=posted)
 *  - manufacturing → odoo_manufacturing (state=done, by date_finished)
 *
 * Returns each metric as {today, yesterday, delta_pct} pair so the UI can
 * paint trend arrows without doing math.
 */

export interface PulseMetric {
  today: number;
  yesterday: number;
  countToday: number;
  countYesterday: number;
  /** Rolling 7-day total (today inclusive). Useful for KPIs with 1-3d lag. */
  last7d: number;
  countLast7d: number;
  deltaPct: number | null;
}

export interface TodayPulse {
  sales: PulseMetric;
  collections: PulseMetric;
  payments: PulseMetric;
  manufacturing: PulseMetric; // units produced
  generatedAt: string;
}

function pct(today: number, yesterday: number): number | null {
  if (!yesterday || yesterday === 0) return null;
  return ((today - yesterday) / Math.abs(yesterday)) * 100;
}

async function _getTodayPulseRaw(): Promise<TodayPulse> {
  const sb = getServiceClient();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // inclusive of today = 7d window
  const sevenDaysAgoIso = sevenDaysAgo.toISOString().slice(0, 10);

  // ─── 1) Sales ─────────────────────────────────────────────────────
  // Pull 7d window so we can compute today/yesterday/last7d in one query.
  // Sales reported SIN IVA (subtotal) for consistency with P&L 401+402.
  // canonical_invoices stores amount_total_mxn_resolved (con IVA) but no
  // amount_untaxed_mxn_resolved; derive ratio from amount_untaxed_odoo /
  // amount_total_odoo (or SAT fallback) and apply to the MXN-resolved total.
  const salesQ = sb
    .from("canonical_invoices")
    .select(
      "invoice_date_resolved, amount_total_mxn_resolved, amount_total_odoo, amount_untaxed_odoo, amount_total_sat, amount_untaxed_sat, state_odoo, estado_sat",
    )
    .eq("direction", "issued")
    .eq("move_type_odoo", "out_invoice")
    .eq("is_non_operational", false) // exclude sale-leaseback / asset disposal CFDIs
    .gte("invoice_date_resolved", sevenDaysAgoIso)
    .lte("invoice_date_resolved", todayIso);

  // ─── 2/3) Collections + Payments ──────────────────────────────────
  // canonical_payments — direction=received for AR, sent for AP. The
  // canonical layer has 1-3 day lag (matchers run every 2h), but it's
  // the only source with MXN-resolved amounts. odoo_account_payments
  // is sparse (~6 rows in 2026 because Quimibond reconciles via journal
  // entries, not account.payment).
  const paymentsQ = sb
    .from("canonical_payments")
    .select("payment_date_resolved, amount_mxn_resolved, direction")
    .gte("payment_date_resolved", sevenDaysAgoIso)
    .lte("payment_date_resolved", todayIso);

  // ─── 4) Manufacturing ─────────────────────────────────────────────
  const mfgQ = sb
    .from("odoo_manufacturing")
    .select("date_finished, qty_produced, state")
    .eq("state", "done")
    .gte("date_finished", `${sevenDaysAgoIso}T00:00:00`)
    .lt("date_finished", `${todayIso}T23:59:59.999`);

  const [salesRes, paymentsRes, mfgRes] = await Promise.all([
    salesQ,
    paymentsQ,
    mfgQ,
  ]);

  // ── Bucket sales (today / yesterday / 7d) ─────────────────────
  type SaleRow = {
    invoice_date_resolved: string | null;
    amount_total_mxn_resolved: number | null;
    amount_total_odoo: number | null;
    amount_untaxed_odoo: number | null;
    amount_total_sat: number | null;
    amount_untaxed_sat: number | null;
    state_odoo: string | null;
    estado_sat: string | null;
  };
  const salesRows = (salesRes.data ?? []) as SaleRow[];
  const isVigente = (r: SaleRow) =>
    (r.state_odoo === "posted" || r.state_odoo === null) &&
    (r.estado_sat === "vigente" || r.estado_sat === null);

  // Derive sin-IVA MXN amount from MXN-resolved total × (untaxed/total ratio).
  // Falls back to 1.0 if neither source has untaxed/total > 0 (rare).
  const sinIvaMxn = (r: SaleRow): number => {
    const totalMxn = Number(r.amount_total_mxn_resolved) || 0;
    if (!totalMxn) return 0;
    const tOdoo = Number(r.amount_total_odoo) || 0;
    const uOdoo = Number(r.amount_untaxed_odoo) || 0;
    const tSat = Number(r.amount_total_sat) || 0;
    const uSat = Number(r.amount_untaxed_sat) || 0;
    let ratio: number | null = null;
    if (tOdoo > 0 && uOdoo > 0) ratio = uOdoo / tOdoo;
    else if (tSat > 0 && uSat > 0) ratio = uSat / tSat;
    if (ratio === null) return totalMxn;
    return totalMxn * ratio;
  };

  let salesT = 0,
    salesY = 0,
    sales7 = 0,
    salesTn = 0,
    salesYn = 0,
    sales7n = 0;
  for (const r of salesRows) {
    if (!isVigente(r)) continue;
    const amt = sinIvaMxn(r);
    sales7 += amt;
    sales7n += 1;
    if (r.invoice_date_resolved === todayIso) {
      salesT += amt;
      salesTn += 1;
    } else if (r.invoice_date_resolved === yesterdayIso) {
      salesY += amt;
      salesYn += 1;
    }
  }

  // ── Bucket payments by date + direction (canonical, MXN) ──────
  type PayRow = {
    payment_date_resolved: string | null;
    amount_mxn_resolved: number | null;
    direction: string | null;
  };
  const payRows = (paymentsRes.data ?? []) as PayRow[];
  let collT = 0,
    collY = 0,
    coll7 = 0,
    collTn = 0,
    collYn = 0,
    coll7n = 0;
  let payT = 0,
    payY = 0,
    pay7 = 0,
    payTn = 0,
    payYn = 0,
    pay7n = 0;
  for (const r of payRows) {
    const amt = Math.abs(Number(r.amount_mxn_resolved) || 0);
    const day = r.payment_date_resolved;
    if (r.direction === "received") {
      coll7 += amt;
      coll7n += 1;
      if (day === todayIso) {
        collT += amt;
        collTn += 1;
      } else if (day === yesterdayIso) {
        collY += amt;
        collYn += 1;
      }
    } else if (r.direction === "sent") {
      pay7 += amt;
      pay7n += 1;
      if (day === todayIso) {
        payT += amt;
        payTn += 1;
      } else if (day === yesterdayIso) {
        payY += amt;
        payYn += 1;
      }
    }
  }

  // ── Bucket manufacturing ──────────────────────────────────────
  type MfgRow = {
    date_finished: string | null;
    qty_produced: number | null;
  };
  const mfgRows = (mfgRes.data ?? []) as MfgRow[];
  let mfgT = 0,
    mfgY = 0,
    mfg7 = 0,
    mfgTn = 0,
    mfgYn = 0,
    mfg7n = 0;
  for (const r of mfgRows) {
    const qty = Number(r.qty_produced) || 0;
    const day = (r.date_finished ?? "").slice(0, 10);
    mfg7 += qty;
    mfg7n += 1;
    if (day === todayIso) {
      mfgT += qty;
      mfgTn += 1;
    } else if (day === yesterdayIso) {
      mfgY += qty;
      mfgYn += 1;
    }
  }

  return {
    sales: {
      today: salesT,
      yesterday: salesY,
      countToday: salesTn,
      countYesterday: salesYn,
      last7d: sales7,
      countLast7d: sales7n,
      deltaPct: pct(salesT, salesY),
    },
    collections: {
      today: collT,
      yesterday: collY,
      countToday: collTn,
      countYesterday: collYn,
      last7d: coll7,
      countLast7d: coll7n,
      deltaPct: pct(collT, collY),
    },
    payments: {
      today: payT,
      yesterday: payY,
      countToday: payTn,
      countYesterday: payYn,
      last7d: pay7,
      countLast7d: pay7n,
      deltaPct: pct(payT, payY),
    },
    manufacturing: {
      today: mfgT,
      yesterday: mfgY,
      countToday: mfgTn,
      countYesterday: mfgYn,
      last7d: mfg7,
      countLast7d: mfg7n,
      deltaPct: pct(mfgT, mfgY),
    },
    generatedAt: new Date().toISOString(),
  };
}

export const getTodayPulse = unstable_cache(
  _getTodayPulseRaw,
  ["sp13-home-today-pulse-v3-nonop-filter"],
  { revalidate: 60, tags: ["dashboard", "home"] },
);
