import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Month-to-date aggregates with same-day-last-month comparison.
 *
 * Sources:
 *  - sales        → canonical_invoices (issued/out_invoice/posted/vigente),
 *                    excluding internal + related-party receptors
 *  - collections  → canonical_payments (direction=received, amount_mxn_resolved)
 *  - payments     → canonical_payments (direction=sent)
 *                    Note: 3-day lag in canonical_payments is acceptable for MTD
 *  - manufacturing → odoo_manufacturing (state=done, qty_produced)
 *
 * Returns each metric as {mtd, lastMtd, projectionFullMonth}. Frontend can
 * display the % delta and project run-rate.
 */

export interface MtdMetric {
  mtd: number;
  lastMtd: number;
  countMtd: number;
  countLastMtd: number;
  deltaPct: number | null;
  /** Linear run-rate projection for the full month (mtd / dayOfMonth × daysInMonth). */
  projection: number;
}

export interface MonthToDate {
  sales: MtdMetric;
  collections: MtdMetric;
  payments: MtdMetric;
  manufacturing: MtdMetric;
  dayOfMonth: number;
  daysInMonth: number;
  generatedAt: string;
}

function pct(mtd: number, lastMtd: number): number | null {
  if (!lastMtd || lastMtd === 0) return null;
  return ((mtd - lastMtd) / Math.abs(lastMtd)) * 100;
}

function project(mtd: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0) return 0;
  return (mtd / dayOfMonth) * daysInMonth;
}

async function _getMonthToDateRaw(): Promise<MonthToDate> {
  const sb = getServiceClient();

  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();

  const yyyy = today.getFullYear();
  const mm = today.getMonth();

  const monthStart = new Date(yyyy, mm, 1).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);
  const lastMonthStart = new Date(yyyy, mm - 1, 1).toISOString().slice(0, 10);
  const lastMonthSameDay = new Date(yyyy, mm - 1, dayOfMonth)
    .toISOString()
    .slice(0, 10);

  // ─── Sales ─────────────────────────────────────────────────────
  // Pull both windows in one query (smaller of two ranges = current month)
  // and bucket client-side to avoid a second roundtrip.
  const salesQ = sb
    .from("canonical_invoices")
    .select(
      `invoice_date_resolved, amount_total_mxn_resolved, amount_total_odoo, amount_untaxed_odoo, amount_total_sat, amount_untaxed_sat, state_odoo, estado_sat,
       receptor:canonical_companies!receptor_canonical_company_id(is_internal,is_related_party)`,
    )
    .eq("direction", "issued")
    .eq("move_type_odoo", "out_invoice")
    .gte("invoice_date_resolved", lastMonthStart)
    .lte("invoice_date_resolved", todayIso);

  // ─── Payments (collections + payments) ─────────────────────────
  const payQ = sb
    .from("canonical_payments")
    .select(
      "payment_date_resolved, amount_mxn_resolved, direction",
    )
    .gte("payment_date_resolved", lastMonthStart)
    .lte("payment_date_resolved", todayIso);

  // ─── Manufacturing ─────────────────────────────────────────────
  const mfgQ = sb
    .from("odoo_manufacturing")
    .select("date_finished, qty_produced, state")
    .eq("state", "done")
    .gte("date_finished", `${lastMonthStart}T00:00:00`)
    .lt("date_finished", `${todayIso}T23:59:59.999`);

  const [salesRes, payRes, mfgRes] = await Promise.all([salesQ, payQ, mfgQ]);

  // ── Sales bucket ──────────────────────────────────────────
  // Supabase types FK embeds as arrays even on many-to-one. We treat as
  // {0 or 1} element list and pull the first.
  type Receptor = { is_internal: boolean | null; is_related_party: boolean | null };
  type SaleRow = {
    invoice_date_resolved: string | null;
    amount_total_mxn_resolved: number | null;
    amount_total_odoo: number | null;
    amount_untaxed_odoo: number | null;
    amount_total_sat: number | null;
    amount_untaxed_sat: number | null;
    state_odoo: string | null;
    estado_sat: string | null;
    receptor: Receptor[] | Receptor | null;
  };
  const salesRows = (salesRes.data ?? []) as unknown as SaleRow[];

  // Derive sin-IVA MXN amount: ratio = untaxed/total (Odoo first, SAT fallback).
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

  let salesMtd = 0,
    salesLast = 0,
    salesMtdN = 0,
    salesLastN = 0;
  for (const r of salesRows) {
    if (!r.invoice_date_resolved) continue;
    const stateOk =
      (r.state_odoo === "posted" || r.state_odoo === null) &&
      (r.estado_sat === "vigente" || r.estado_sat === null);
    if (!stateOk) continue;
    const recRaw = r.receptor;
    const rec: Receptor | null = Array.isArray(recRaw) ? (recRaw[0] ?? null) : recRaw;
    const isInternal = rec?.is_internal === true;
    const isRelated = rec?.is_related_party === true;
    if (isInternal || isRelated) continue;
    const amt = sinIvaMxn(r);
    if (r.invoice_date_resolved >= monthStart) {
      salesMtd += amt;
      salesMtdN += 1;
    } else if (
      r.invoice_date_resolved >= lastMonthStart &&
      r.invoice_date_resolved <= lastMonthSameDay
    ) {
      salesLast += amt;
      salesLastN += 1;
    }
  }

  // ── Payments bucket ───────────────────────────────────────
  type PayRow = {
    payment_date_resolved: string | null;
    amount_mxn_resolved: number | null;
    direction: string | null;
  };
  const payRows = (payRes.data ?? []) as PayRow[];

  let collMtd = 0,
    collLast = 0,
    collMtdN = 0,
    collLastN = 0;
  let payMtd = 0,
    payLast = 0,
    payMtdN = 0,
    payLastN = 0;
  for (const r of payRows) {
    if (!r.payment_date_resolved) continue;
    // canonical_payments stores 'sent' as negative MXN — flip for display.
    const amt = Math.abs(Number(r.amount_mxn_resolved) || 0);
    const inMtd = r.payment_date_resolved >= monthStart;
    const inLast =
      r.payment_date_resolved >= lastMonthStart &&
      r.payment_date_resolved <= lastMonthSameDay;
    if (r.direction === "received") {
      if (inMtd) {
        collMtd += amt;
        collMtdN += 1;
      } else if (inLast) {
        collLast += amt;
        collLastN += 1;
      }
    } else if (r.direction === "sent") {
      if (inMtd) {
        payMtd += amt;
        payMtdN += 1;
      } else if (inLast) {
        payLast += amt;
        payLastN += 1;
      }
    }
  }

  // ── Manufacturing bucket ──────────────────────────────────
  type MfgRow = { date_finished: string | null; qty_produced: number | null };
  const mfgRows = (mfgRes.data ?? []) as MfgRow[];

  let mfgMtd = 0,
    mfgLast = 0,
    mfgMtdN = 0,
    mfgLastN = 0;
  for (const r of mfgRows) {
    const day = (r.date_finished ?? "").slice(0, 10);
    if (!day) continue;
    const qty = Number(r.qty_produced) || 0;
    if (day >= monthStart) {
      mfgMtd += qty;
      mfgMtdN += 1;
    } else if (day >= lastMonthStart && day <= lastMonthSameDay) {
      mfgLast += qty;
      mfgLastN += 1;
    }
  }

  return {
    sales: {
      mtd: salesMtd,
      lastMtd: salesLast,
      countMtd: salesMtdN,
      countLastMtd: salesLastN,
      deltaPct: pct(salesMtd, salesLast),
      projection: project(salesMtd, dayOfMonth, daysInMonth),
    },
    collections: {
      mtd: collMtd,
      lastMtd: collLast,
      countMtd: collMtdN,
      countLastMtd: collLastN,
      deltaPct: pct(collMtd, collLast),
      projection: project(collMtd, dayOfMonth, daysInMonth),
    },
    payments: {
      mtd: payMtd,
      lastMtd: payLast,
      countMtd: payMtdN,
      countLastMtd: payLastN,
      deltaPct: pct(payMtd, payLast),
      projection: project(payMtd, dayOfMonth, daysInMonth),
    },
    manufacturing: {
      mtd: mfgMtd,
      lastMtd: mfgLast,
      countMtd: mfgMtdN,
      countLastMtd: mfgLastN,
      deltaPct: pct(mfgMtd, mfgLast),
      projection: project(mfgMtd, dayOfMonth, daysInMonth),
    },
    dayOfMonth,
    daysInMonth,
    generatedAt: new Date().toISOString(),
  };
}

export const getMonthToDate = unstable_cache(
  _getMonthToDateRaw,
  ["sp13-home-month-to-date-v2-sinIva"],
  { revalidate: 120, tags: ["dashboard", "home"] },
);
