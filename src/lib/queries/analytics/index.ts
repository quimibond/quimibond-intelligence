import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Analytics queries — wrappers tipados sobre modelos Silver/Gold SP5:
 * - `rfm_segments` (matview)         — segmentación RFM 8-buckets + priority score
 * - `collection_effectiveness_index` — CEI cohort mensual + health_status
 * - `revenue_concentration` (view)   — rank Pareto + tripwires top 5/10
 * - `stockout_queue` (view)          — cola de productos en riesgo de faltante
 * - `real_sale_price` (matview)      — precio real ponderado por cantidad
 * - `customer_cohorts` (matview)     — retention quarterly heatmap
 *
 * Banned (dropped SP1) — reads removed in Task 7:
 * - supplier_price_index   → getSupplierPriceAlerts() returns [] (TODO SP6: canonical_order_lines)
 *
 * Barrel re-exports for domain files:
 */
export * from "./customer-360";
export * from "./dashboard";
export * from "./currency-rates";
export * from "./pnl";
export * from "./products";

// Note: finance.ts and products.ts are exported separately by their pages;
// they are NOT re-exported here to avoid circular conflicts on large bundlers.

// ──────────────────────────────────────────────────────────────────────────
// RFM Segments
// ──────────────────────────────────────────────────────────────────────────
export type RfmSegment =
  | "CHAMPIONS"
  | "LOYAL"
  | "AT_RISK"
  | "NEW"
  | "NEED_ATTENTION"
  | "HIBERNATING"
  | "LOST"
  | "OCCASIONAL";

export interface RfmSegmentRow {
  company_id: number;
  company_name: string;
  tier: string | null;
  segment: RfmSegment;
  recency_days: number;
  frequency: number;
  monetary_2y: number;
  monetary_12m: number;
  monetary_90d: number;
  avg_ticket: number;
  outstanding: number;
  max_days_overdue: number | null;
  last_purchase: string | null;
  first_purchase: string | null;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_code: number;
  contact_priority_score: number;
}

async function _getRfmSegmentsRaw(
  segment?: RfmSegment,
  limit = 200
): Promise<RfmSegmentRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("rfm_segments") // SP5-EXCEPTION: §12 banned MV — RFM segmentation read; no canonical replacement in SP5 scope. TODO SP6: replace with gold_rfm_segments or canonical_company_metrics.
    .select(
      "company_id, company_name, tier, segment, recency_days, frequency, monetary_2y, monetary_12m, monetary_90d, avg_ticket, outstanding, max_days_overdue, last_purchase, first_purchase, r_score, f_score, m_score, rfm_code, contact_priority_score"
    )
    .order("contact_priority_score", { ascending: false })
    .limit(limit);
  if (segment) q = q.eq("segment", segment);
  const { data } = await q;
  return ((data ?? []) as Array<Partial<RfmSegmentRow>>).map((r) => ({
    company_id: Number(r.company_id) || 0,
    company_name: r.company_name ?? "—",
    tier: r.tier ?? null,
    segment: (r.segment as RfmSegment) ?? "OCCASIONAL",
    recency_days: Number(r.recency_days) || 0,
    frequency: Number(r.frequency) || 0,
    monetary_2y: Number(r.monetary_2y) || 0,
    monetary_12m: Number(r.monetary_12m) || 0,
    monetary_90d: Number(r.monetary_90d) || 0,
    avg_ticket: Number(r.avg_ticket) || 0,
    outstanding: Number(r.outstanding) || 0,
    max_days_overdue: r.max_days_overdue != null ? Number(r.max_days_overdue) : null,
    last_purchase: r.last_purchase ?? null,
    first_purchase: r.first_purchase ?? null,
    r_score: Number(r.r_score) || 0,
    f_score: Number(r.f_score) || 0,
    m_score: Number(r.m_score) || 0,
    rfm_code: Number(r.rfm_code) || 0,
    contact_priority_score: Number(r.contact_priority_score) || 0,
  }));
}

// Cache RFM full-table fetch for 60s — rfm_segments is a MV refreshed by pg_cron,
// so 60s staleness is acceptable and eliminates 4 identical round-trips per cold render
// of /companies (CompaniesResumen + ReactivacionSection each call this).
const _getRfmSegmentsCached = unstable_cache(
  _getRfmSegmentsRaw,
  ["rfm_segments"],
  { revalidate: 60, tags: ["rfm_segments"] }
);

export async function getRfmSegments(
  segment?: RfmSegment,
  limit = 200
): Promise<RfmSegmentRow[]> {
  return _getRfmSegmentsCached(segment, limit);
}

export interface RfmSegmentSummary {
  segment: RfmSegment;
  customers: number;
  revenue_12m: number;
  outstanding: number;
  avg_priority: number;
}

export async function getRfmSegmentSummary(): Promise<RfmSegmentSummary[]> {
  const rows = await getRfmSegments(undefined, 1000);
  const map = new Map<RfmSegment, RfmSegmentSummary>();
  for (const r of rows) {
    const cur =
      map.get(r.segment) ??
      ({
        segment: r.segment,
        customers: 0,
        revenue_12m: 0,
        outstanding: 0,
        avg_priority: 0,
      } satisfies RfmSegmentSummary);
    cur.customers += 1;
    cur.revenue_12m += r.monetary_12m;
    cur.outstanding += r.outstanding;
    cur.avg_priority += r.contact_priority_score;
    map.set(r.segment, cur);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      avg_priority: s.customers > 0 ? Math.round(s.avg_priority / s.customers) : 0,
    }))
    .sort((a, b) => b.revenue_12m - a.revenue_12m);
}

// ──────────────────────────────────────────────────────────────────────────
// Collection Effectiveness Index
// ──────────────────────────────────────────────────────────────────────────
export type CeiHealth = "too_recent" | "healthy" | "watch" | "at_risk" | "degraded";

export interface CeiRow {
  cohort_month: string;
  cohort_age_months: number;
  invoices_issued: number;
  customers: number;
  billed_mxn: number;
  collected_mxn: number;
  outstanding_mxn: number;
  overdue_30d_mxn: number;
  overdue_90d_mxn: number;
  cei_pct: number;
  leakage_90d_pct: number;
  avg_days_to_pay: number | null;
  health_status: CeiHealth;
  cei_delta_vs_prev: number | null;
}

async function _getCollectionEffectivenessRaw(
  months: number
): Promise<CeiRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("collection_effectiveness_index")
    .select("*")
    .limit(months);
  return ((data ?? []) as Array<Partial<CeiRow>>).map((r) => ({
    cohort_month: r.cohort_month ?? "",
    cohort_age_months: Number(r.cohort_age_months) || 0,
    invoices_issued: Number(r.invoices_issued) || 0,
    customers: Number(r.customers) || 0,
    billed_mxn: Number(r.billed_mxn) || 0,
    collected_mxn: Number(r.collected_mxn) || 0,
    outstanding_mxn: Number(r.outstanding_mxn) || 0,
    overdue_30d_mxn: Number(r.overdue_30d_mxn) || 0,
    overdue_90d_mxn: Number(r.overdue_90d_mxn) || 0,
    cei_pct: Number(r.cei_pct) || 0,
    leakage_90d_pct: Number(r.leakage_90d_pct) || 0,
    avg_days_to_pay:
      r.avg_days_to_pay != null ? Number(r.avg_days_to_pay) : null,
    health_status: (r.health_status as CeiHealth) ?? "too_recent",
    cei_delta_vs_prev:
      r.cei_delta_vs_prev != null ? Number(r.cei_delta_vs_prev) : null,
  }));
}

const _getCollectionEffectivenessCached = unstable_cache(
  _getCollectionEffectivenessRaw,
  ["analytics-collection-effectiveness-v1"],
  { revalidate: 60, tags: ["collection_effectiveness_index"] }
);

export async function getCollectionEffectiveness(
  months = 12
): Promise<CeiRow[]> {
  return _getCollectionEffectivenessCached(months);
}

// ──────────────────────────────────────────────────────────────────────────
// Revenue Concentration
// ──────────────────────────────────────────────────────────────────────────
export type ConcentrationTripwire =
  | "TOP5_DECLINE_25PCT"
  | "TOP10_DECLINE_40PCT"
  | "TOP5_NO_ORDER_45D";

export interface ConcentrationRow {
  company_id: number;
  company_name: string;
  tier: string | null;
  rank_in_portfolio: number;
  rev_12m: number;
  rev_90d: number;
  rev_30d: number;
  rev_30d_prev: number;
  share_pct: number;
  cumulative_pct: number;
  pareto_class: "A" | "B" | "C";
  last_invoice_date: string | null;
  days_since_last_invoice: number | null;
  rev_30d_delta_pct: number | null;
  tripwire: ConcentrationTripwire | null;
}

/**
 * Revenue concentration replacement — computed in TypeScript from
 * canonical_invoices + canonical_companies (replaces the `revenue_concentration`
 * MV that was dropped in SP1 batch 1, migration 1068_silver_sp5_drop_batch_1).
 *
 * Same shape as the legacy view + same tripwire heuristics:
 *   - rev_12m / rev_90d / rev_30d / rev_30d_prev windows from invoice_date
 *   - rank_in_portfolio by rev_12m DESC
 *   - share_pct + cumulative_pct (Pareto)
 *   - pareto_class A (≤80%) / B (≤95%) / C
 *   - tripwires:
 *       TOP5_DECLINE_25PCT  → top-5 with rev_30d down >25% MoM
 *       TOP10_DECLINE_40PCT → top-10 with rev_30d down >40% MoM
 *       TOP5_NO_ORDER_45D   → top-5 with no invoice in 45+ days
 *
 * Filters internal companies (canonical_companies.is_internal=true) so
 * inter-company revenue doesn't pollute the rank.
 *
 * Cached 300s — revenue concentration changes slowly and the view is
 * read on every / page load.
 */
async function _getRevenueConcentrationRaw(
  topN: number = 30,
): Promise<ConcentrationRow[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  const sinceIso = since.toISOString().slice(0, 10);

  // Pull all issued+vigente invoices in the last 365 days. Volume cap:
  // ~2.5k rows in production — fits comfortably in one round-trip.
  const { data: invRows, error } = await sb
    .from("canonical_invoices")
    .select(
      "receptor_canonical_company_id, invoice_date, amount_total_mxn_resolved",
    )
    .eq("direction", "issued")
    .eq("estado_sat", "vigente")
    .gte("invoice_date", sinceIso)
    .not("receptor_canonical_company_id", "is", null)
    .not("invoice_date", "is", null)
    .limit(10000);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[getRevenueConcentration] canonical_invoices query failed:", error.message);
    }
    return [];
  }
  const rawInvoices = (invRows ?? []) as Array<{
    receptor_canonical_company_id: number | null;
    invoice_date: string | null;
    amount_total_mxn_resolved: number | null;
  }>;
  if (rawInvoices.length === 0) return [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoff30 = new Date(today.getTime() - 30 * 86400 * 1000);
  const cutoff60 = new Date(today.getTime() - 60 * 86400 * 1000);
  const cutoff90 = new Date(today.getTime() - 90 * 86400 * 1000);

  // Aggregate per company
  interface Agg {
    rev_12m: number;
    rev_90d: number;
    rev_30d: number;
    rev_30d_prev: number;
    last_invoice_date: string | null;
    /** First invoice in the 12-month window — used to detect one-off mega-invoices. */
    first_invoice_date: string | null;
    /** Distinct issued invoice count — used to filter related-party / one-off transactions. */
    invoice_count: number;
  }
  const byCompany = new Map<number, Agg>();
  for (const r of rawInvoices) {
    if (r.receptor_canonical_company_id == null || r.invoice_date == null) continue;
    const amount = Number(r.amount_total_mxn_resolved) || 0;
    if (amount <= 0) continue;
    const d = new Date(r.invoice_date);
    const id = r.receptor_canonical_company_id;
    const a = byCompany.get(id) ?? {
      rev_12m: 0,
      rev_90d: 0,
      rev_30d: 0,
      rev_30d_prev: 0,
      last_invoice_date: null,
      first_invoice_date: null,
      invoice_count: 0,
    };
    a.rev_12m += amount;
    a.invoice_count += 1;
    if (d >= cutoff90) a.rev_90d += amount;
    if (d >= cutoff30) a.rev_30d += amount;
    else if (d >= cutoff60) a.rev_30d_prev += amount;
    if (a.last_invoice_date == null || r.invoice_date > a.last_invoice_date) {
      a.last_invoice_date = r.invoice_date;
    }
    if (a.first_invoice_date == null || r.invoice_date < a.first_invoice_date) {
      a.first_invoice_date = r.invoice_date;
    }
    byCompany.set(id, a);
  }

  // Resolve display_name + tier + is_internal for the companies in the bucket
  const ids = [...byCompany.keys()];
  if (ids.length === 0) return [];
  const { data: ccData } = await sb
    .from("canonical_companies")
    .select("id, display_name, tier, is_internal")
    .in("id", ids);
  type CC = {
    id: number;
    display_name: string | null;
    tier: string | null;
    is_internal: boolean | null;
  };
  const ccMap = new Map<number, CC>();
  for (const c of (ccData ?? []) as CC[]) ccMap.set(c.id, c);

  // Filter:
  //   1. is_internal=true → inter-company / self-invoicing (e.g., LEPEZO group cross-billing)
  //   2. < 3 issued invoices in 12m → one-off transactions (sale-leaseback, scrap sale, etc.)
  //      that wildly distort the rank because they have no MoM history.
  //   3. < 60 days of activity span → very new accounts that haven't established
  //      a baseline yet; tripwires would fire spuriously on the first month.
  // The MIN_INVOICES + MIN_SPAN_DAYS filters protect us from related-party
  // transactions that show up as "top customers" with -100% MoM (e.g.,
  // LEASING LEPEZO showed up because of a single $13M issued invoice that
  // looks like a sale-leaseback).
  const MIN_INVOICES = 3;
  const MIN_SPAN_DAYS = 60;
  const ranked: Array<{
    company_id: number;
    company_name: string;
    tier: string | null;
    agg: Agg;
  }> = [];
  let totalRev12m = 0;
  for (const [id, agg] of byCompany.entries()) {
    const cc = ccMap.get(id);
    if (cc?.is_internal) continue;
    if (agg.invoice_count < MIN_INVOICES) continue;
    if (agg.first_invoice_date && agg.last_invoice_date) {
      const spanDays =
        (new Date(agg.last_invoice_date).getTime() -
          new Date(agg.first_invoice_date).getTime()) /
        (86400 * 1000);
      if (spanDays < MIN_SPAN_DAYS) continue;
    }
    totalRev12m += agg.rev_12m;
    ranked.push({
      company_id: id,
      company_name: cc?.display_name ?? `#${id}`,
      tier: cc?.tier ?? null,
      agg,
    });
  }
  ranked.sort((a, b) => b.agg.rev_12m - a.agg.rev_12m);

  // Compute rank, share, cumulative, pareto, tripwires
  let cumulative = 0;
  const rows: ConcentrationRow[] = ranked.slice(0, topN).map((r, i) => {
    const rank = i + 1;
    const sharePct = totalRev12m > 0 ? (r.agg.rev_12m / totalRev12m) * 100 : 0;
    cumulative += r.agg.rev_12m;
    const cumPct =
      totalRev12m > 0 ? (cumulative / totalRev12m) * 100 : 0;
    const paretoClass: "A" | "B" | "C" =
      cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";

    const lastInv = r.agg.last_invoice_date;
    const daysSinceLast =
      lastInv != null
        ? Math.floor(
            (today.getTime() - new Date(lastInv).getTime()) / (86400 * 1000),
          )
        : null;

    const delta30Pct =
      r.agg.rev_30d_prev > 0
        ? ((r.agg.rev_30d - r.agg.rev_30d_prev) / r.agg.rev_30d_prev) * 100
        : null;

    let tripwire: ConcentrationTripwire | null = null;
    if (
      rank <= 5 &&
      r.agg.rev_30d_prev > 0 &&
      delta30Pct != null &&
      delta30Pct < -25
    ) {
      tripwire = "TOP5_DECLINE_25PCT";
    } else if (
      rank <= 10 &&
      r.agg.rev_30d_prev > 0 &&
      delta30Pct != null &&
      delta30Pct < -40
    ) {
      tripwire = "TOP10_DECLINE_40PCT";
    } else if (rank <= 5 && daysSinceLast != null && daysSinceLast > 45) {
      tripwire = "TOP5_NO_ORDER_45D";
    }

    return {
      company_id: r.company_id,
      company_name: r.company_name,
      tier: r.tier,
      rank_in_portfolio: rank,
      rev_12m: Math.round(r.agg.rev_12m * 100) / 100,
      rev_90d: Math.round(r.agg.rev_90d * 100) / 100,
      rev_30d: Math.round(r.agg.rev_30d * 100) / 100,
      rev_30d_prev: Math.round(r.agg.rev_30d_prev * 100) / 100,
      share_pct: Math.round(sharePct * 100) / 100,
      cumulative_pct: Math.round(cumPct * 100) / 100,
      pareto_class: paretoClass,
      last_invoice_date: lastInv,
      days_since_last_invoice: daysSinceLast,
      rev_30d_delta_pct:
        delta30Pct != null ? Math.round(delta30Pct * 10) / 10 : null,
      tripwire,
    };
  });
  return rows;
}

export const getRevenueConcentration = unstable_cache(
  _getRevenueConcentrationRaw,
  ["analytics-revenue-concentration"],
  { revalidate: 300, tags: ["revenue", "companies"] },
);

export async function getActiveTripwires(): Promise<ConcentrationRow[]> {
  const all = await getRevenueConcentration(50);
  return all.filter((r) => r.tripwire !== null);
}

// ──────────────────────────────────────────────────────────────────────────
// Stockout Queue
// ──────────────────────────────────────────────────────────────────────────
export type StockoutUrgency =
  | "STOCKOUT"
  | "CRITICAL"
  | "URGENT"
  | "ATTENTION"
  | "OK";

export interface StockoutRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  category: string | null;
  stock_qty: number;
  reserved_qty: number;
  available_qty: number;
  daily_run_rate: number;
  qty_sold_90d: number;
  days_of_stock: number | null;
  revenue_at_risk_30d_mxn: number;
  replenish_cost_mxn: number;
  suggested_order_qty: number;
  qty_on_order: number;
  top_consumer: string | null;
  last_supplier_id: number | null;
  last_supplier_name: string | null;
  last_purchase_price: number | null;
  last_purchase_date: string | null;
  urgency: StockoutUrgency;
  priority_score: number;
}

async function _getStockoutQueueRaw(
  urgency?: StockoutUrgency,
  limit = 100
): Promise<StockoutRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("stockout_queue")
    .select("*")
    .order("priority_score", { ascending: false })
    .limit(limit);
  if (urgency) q = q.eq("urgency", urgency);
  const { data } = await q;
  return ((data ?? []) as Array<Partial<StockoutRow>>).map((r) => ({
    odoo_product_id: Number(r.odoo_product_id) || 0,
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    category: r.category ?? null,
    stock_qty: Number(r.stock_qty) || 0,
    reserved_qty: Number(r.reserved_qty) || 0,
    available_qty: Number(r.available_qty) || 0,
    daily_run_rate: Number(r.daily_run_rate) || 0,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    days_of_stock: r.days_of_stock != null ? Number(r.days_of_stock) : null,
    revenue_at_risk_30d_mxn: Number(r.revenue_at_risk_30d_mxn) || 0,
    replenish_cost_mxn: Number(r.replenish_cost_mxn) || 0,
    suggested_order_qty: Number(r.suggested_order_qty) || 0,
    qty_on_order: Number(r.qty_on_order) || 0,
    top_consumer: r.top_consumer ?? null,
    last_supplier_id:
      r.last_supplier_id != null ? Number(r.last_supplier_id) : null,
    last_supplier_name: r.last_supplier_name ?? null,
    last_purchase_price:
      r.last_purchase_price != null ? Number(r.last_purchase_price) : null,
    last_purchase_date: r.last_purchase_date ?? null,
    urgency: (r.urgency as StockoutUrgency) ?? "OK",
    priority_score: Number(r.priority_score) || 0,
  }));
}

// Cache stockout_queue for 60s — it's a view over inventory_velocity (MV) and
// real-time stock won't change faster than the Odoo sync (1h). Saves ~42ms on cold render.
const _getStockoutQueueCached = unstable_cache(
  _getStockoutQueueRaw,
  ["stockout_queue"],
  { revalidate: 60, tags: ["stockout_queue"] }
);

export async function getStockoutQueue(
  urgency?: StockoutUrgency,
  limit = 100
): Promise<StockoutRow[]> {
  return _getStockoutQueueCached(urgency, limit);
}

export interface StockoutSummary {
  urgency: StockoutUrgency;
  count: number;
  revenue_at_risk: number;
}

export async function getStockoutSummary(): Promise<StockoutSummary[]> {
  const rows = await getStockoutQueue(undefined, 500);
  const map = new Map<StockoutUrgency, StockoutSummary>();
  for (const r of rows) {
    const cur =
      map.get(r.urgency) ??
      ({ urgency: r.urgency, count: 0, revenue_at_risk: 0 } satisfies StockoutSummary);
    cur.count += 1;
    cur.revenue_at_risk += r.revenue_at_risk_30d_mxn;
    map.set(r.urgency, cur);
  }
  const order: Record<StockoutUrgency, number> = {
    STOCKOUT: 1,
    CRITICAL: 2,
    URGENT: 3,
    ATTENTION: 4,
    OK: 5,
  };
  return [...map.values()].sort((a, b) => order[a.urgency] - order[b.urgency]);
}

// ──────────────────────────────────────────────────────────────────────────
// Supplier Price Alerts
// supplier_price_index was on the SP1 drop list. Reads replaced with empty
// return + TODO SP6 stub. Interface preserved for consumers (compras/page.tsx).
// TODO SP6: reimplement via canonical_order_lines purchase aggregation + benchmark logic.
// ──────────────────────────────────────────────────────────────────────────
export type PriceFlag =
  | "single_source"
  | "overpriced"
  | "above_market"
  | "aligned"
  | "below_market";

export interface SupplierPriceRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  supplier_id: number;
  supplier_name: string;
  month: string;
  supplier_avg_price: number;
  benchmark_price: number;
  suppliers_in_month: number;
  price_index: number;
  price_delta: number;
  overpaid_mxn: number;
  saved_mxn: number;
  supplier_qty: number;
  supplier_spend: number;
  supplier_lines: number;
  last_po_date: string | null;
  last_po_name: string | null;
  price_flag: PriceFlag;
}

export async function getSupplierPriceAlerts(
  _flag: PriceFlag = "overpriced",
  _monthsBack = 6,
  _limit = 50
): Promise<SupplierPriceRow[]> {
  // TODO SP6: supplier_price_index dropped in SP1. Reimplement via
  // canonical_order_lines (purchase) aggregation with per-product benchmark logic
  // from purchase_price_intelligence MV (pending creation).
  return [];
}

// ──────────────────────────────────────────────────────────────────────────
// Real Sale Price
// ──────────────────────────────────────────────────────────────────────────
export interface RealSalePriceRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  price_current: number | null;
  price_90d: number | null;
  price_180d: number | null;
  price_12m: number | null;
  cv_12m: number | null;
  qty_sold_90d: number;
  qty_sold_12m: number;
  revenue_12m: number;
  customers_12m: number;
  odoo_cost: number | null;
  markup_vs_cost_pct: number | null;
  list_price_is_stale: boolean;
  last_sale_date: string | null;
}

export async function getRealSalePrices(
  limit = 100
): Promise<RealSalePriceRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("real_sale_price")
    .select("*")
    .order("revenue_12m", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<RealSalePriceRow>>).map((r) => ({
    odoo_product_id: Number(r.odoo_product_id) || 0,
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    price_current: r.price_current != null ? Number(r.price_current) : null,
    price_90d: r.price_90d != null ? Number(r.price_90d) : null,
    price_180d: r.price_180d != null ? Number(r.price_180d) : null,
    price_12m: r.price_12m != null ? Number(r.price_12m) : null,
    cv_12m: r.cv_12m != null ? Number(r.cv_12m) : null,
    qty_sold_90d: Number(r.qty_sold_90d) || 0,
    qty_sold_12m: Number(r.qty_sold_12m) || 0,
    revenue_12m: Number(r.revenue_12m) || 0,
    customers_12m: Number(r.customers_12m) || 0,
    odoo_cost: r.odoo_cost != null ? Number(r.odoo_cost) : null,
    markup_vs_cost_pct:
      r.markup_vs_cost_pct != null ? Number(r.markup_vs_cost_pct) : null,
    list_price_is_stale: !!r.list_price_is_stale,
    last_sale_date: r.last_sale_date ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Customer Cohorts (matview — SP5 KEEP)
// ──────────────────────────────────────────────────────────────────────────
export interface CohortCellRow {
  cohort_quarter: string;
  revenue_quarter: string;
  quarters_since_first: number;
  active_customers: number;
  cohort_revenue: number;
  avg_revenue_per_customer: number;
}

export interface CohortMatrix {
  cohorts: string[];
  maxQuarters: number;
  /** matrix[cohortIdx][quartersSinceFirst] = celda (o null) */
  matrix: Array<Array<CohortCellRow | null>>;
  /** baseSize[cohortIdx] = active_customers en quarter 0 */
  baseSize: number[];
}

/** Round YYYY-MM-DD → start of its quarter (YYYY-MM-DD of Jan/Apr/Jul/Oct). */
function quarterStart(monthStart: string): string {
  const [yStr, mStr] = monthStart.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const qMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qMonth).padStart(2, "0")}-01`;
}

/**
 * Customer retention cohorts derived from gold_revenue_monthly.
 *
 * 2026-04-25: the prior implementation read `customer_cohorts` MV which
 * was dropped in Silver SP1. We rebuild the matrix in-memory from
 * gold_revenue_monthly (per-company monthly revenue, ~20k rows). For
 * each company we take its earliest month with revenue as its cohort
 * quarter, then bucket subsequent active quarters as retention.
 *
 * `monthsBack` controls how deep the cohort window goes (default 36m).
 */
export async function getCustomerCohorts(
  monthsBack = 36
): Promise<CohortMatrix> {
  const sb = getServiceClient();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // PostgREST caps a single response at 1000 rows; paginate explicitly so we
  // don't silently truncate the cohort matrix.
  type GR = {
    canonical_company_id: number | null;
    month_start: string | null;
    resolved_mxn: number | null;
    odoo_mxn: number | null;
  };
  const rows: Array<GR & { canonical_company_id: number; month_start: string }> = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50000; offset += PAGE) {
    const { data, error } = await sb
      .from("gold_revenue_monthly")
      .select("canonical_company_id, month_start, resolved_mxn, odoo_mxn")
      .not("canonical_company_id", "is", null)
      .gte("month_start", cutoffStr)
      .order("canonical_company_id", { ascending: true })
      .order("month_start", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.warn(
        "[getCustomerCohorts] gold_revenue_monthly read failed:",
        error.message
      );
      return { cohorts: [], maxQuarters: 0, matrix: [], baseSize: [] };
    }
    const page = (data ?? []) as GR[];
    for (const r of page) {
      if (
        typeof r.canonical_company_id === "number" &&
        typeof r.month_start === "string"
      ) {
        rows.push(
          r as GR & { canonical_company_id: number; month_start: string }
        );
      }
    }
    if (page.length < PAGE) break;
  }

  // Aggregate per (company, quarter): revenue + isActive flag.
  const perCompanyQuarters = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const rev = Math.abs(Number(r.resolved_mxn ?? r.odoo_mxn ?? 0));
    if (rev === 0) continue;
    const q = quarterStart(r.month_start);
    let m = perCompanyQuarters.get(r.canonical_company_id);
    if (!m) {
      m = new Map();
      perCompanyQuarters.set(r.canonical_company_id, m);
    }
    m.set(q, (m.get(q) ?? 0) + rev);
  }

  // Cohort = first quarter the company had revenue.
  const firstQuarterByCompany = new Map<number, string>();
  for (const [companyId, qMap] of perCompanyQuarters.entries()) {
    const earliest = [...qMap.keys()].sort()[0];
    if (earliest) firstQuarterByCompany.set(companyId, earliest);
  }

  // Map (cohort, qIdx) → { activeCustomers, cohortRevenue }.
  type Cell = { active: number; revenue: number };
  const grid = new Map<string, Map<number, Cell>>(); // cohort → qIdx → cell

  function quarterDiff(from: string, to: string): number {
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    return (ty - fy) * 4 + (tm - fm) / 3;
  }

  let maxQuarters = 0;
  for (const [companyId, qMap] of perCompanyQuarters.entries()) {
    const cohort = firstQuarterByCompany.get(companyId);
    if (!cohort) continue;
    for (const [q, rev] of qMap.entries()) {
      const idx = quarterDiff(cohort, q);
      if (idx < 0) continue;
      if (idx > maxQuarters) maxQuarters = idx;
      let cMap = grid.get(cohort);
      if (!cMap) {
        cMap = new Map();
        grid.set(cohort, cMap);
      }
      const prev = cMap.get(idx) ?? { active: 0, revenue: 0 };
      cMap.set(idx, { active: prev.active + 1, revenue: prev.revenue + rev });
    }
  }

  const cohorts = [...grid.keys()].sort();
  const matrix: Array<Array<CohortCellRow | null>> = cohorts.map(() =>
    Array(maxQuarters + 1).fill(null)
  );
  const baseSize: number[] = Array(cohorts.length).fill(0);

  cohorts.forEach((cohort, i) => {
    const cMap = grid.get(cohort);
    if (!cMap) return;
    for (const [idx, cell] of cMap.entries()) {
      const row: CohortCellRow = {
        cohort_quarter: cohort,
        revenue_quarter: "",
        quarters_since_first: idx,
        active_customers: cell.active,
        cohort_revenue: cell.revenue,
        avg_revenue_per_customer:
          cell.active > 0 ? cell.revenue / cell.active : 0,
      };
      matrix[i][idx] = row;
      if (idx === 0) baseSize[i] = cell.active;
    }
  });

  return { cohorts, maxQuarters, matrix, baseSize };
}
