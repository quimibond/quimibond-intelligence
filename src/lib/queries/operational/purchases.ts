import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * Purchases queries v3 — canonical layer (SP5 Task 9, broad sweep pass):
 * - `canonical_purchase_orders` — golden PO record (buyer_canonical_contact_id FK)
 * - `canonical_order_lines` (order_type='purchase') — golden PO lines
 * - `canonical_payments` (direction='sent') — vendor outbound payments
 * - `canonical_invoices` (direction='received') — vendor invoices received
 * - `canonical_contacts` (contact_type LIKE 'internal_%') — buyer metadata
 * - `cfo_dashboard` — retained §12 KEEP (pagos_prov_30d KPI)
 * - `purchase_price_intelligence` — retained §12 KEEP (price anomaly alerts)
 *
 * §12 drop-list reads fully eliminated in this pass:
 *   odoo_purchase_orders → canonical_purchase_orders
 *   invoices_unified (via getUnifiedInvoicesForCompany) → canonical_invoices
 *   supplier_concentration_herfindahl → client-side aggregation from canonical_order_lines (TODO SP6)
 *   supplier_product_matrix → client-side aggregation from canonical_order_lines
 *
 * Schema notes (T9 verified):
 * - canonical_purchase_orders PK: canonical_id (bigint)
 * - canonical_purchase_orders buyer FK: buyer_canonical_contact_id (bigint)
 * - canonical_purchase_orders company FK: canonical_company_id (bigint)
 * - canonical_payments direction values: 'sent' = vendor outflow, 'received' = customer inflow
 * - canonical_payments PK: canonical_id (text)
 * - canonical_payments company FK: counterparty_canonical_company_id (bigint)
 * - canonical_payments amount: amount_mxn_resolved; date: payment_date_resolved
 */

// SP5-VERIFIED: purchase_price_intelligence retained per §12 KEEP
// SP5-VERIFIED: cfo_dashboard retained per §12 KEEP

function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ──────────────────────────────────────────────────────────────────────────
// listPurchaseOrders — required canonical export
// ──────────────────────────────────────────────────────────────────────────
export interface PurchaseOrderRow {
  canonical_id: number;
  odoo_order_id: number | null;
  name: string | null;
  canonical_company_id: number | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_canonical_contact_id: number | null;
  amount_total_mxn: number | null;
  amount_total: number | null;
  currency: string | null;
  state: string | null;
  date_order: string | null;
  date_approve: string | null;
}

export async function listPurchaseOrders(opts: {
  limit?: number;
  from?: string;
  to?: string;
  state?: string[];
}): Promise<PurchaseOrderRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_purchase_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, buyer_name, buyer_email, buyer_canonical_contact_id, amount_total_mxn, amount_total, currency, state, date_order, date_approve"
    )
    .order("date_order", { ascending: false });

  if (opts.from) q = q.gte("date_order", opts.from);
  if (opts.to) q = q.lte("date_order", opts.to);
  if (opts.state && opts.state.length > 0) q = q.in("state", opts.state);
  if (opts.limit) q = q.limit(opts.limit);

  const { data } = await q;
  return (data ?? []) as PurchaseOrderRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// listPurchaseOrderLines — required canonical export
// ──────────────────────────────────────────────────────────────────────────
export interface PurchaseOrderLineRow {
  canonical_id: string;
  order_type: string;
  canonical_product_id: number | null;
  canonical_company_id: number | null;
  order_date: string | null;
  qty: number | null;
  subtotal: number | null;
  subtotal_mxn: number | null;
}

export async function listPurchaseOrderLines(opts: {
  limit?: number;
  from?: string;
  to?: string;
  canonicalCompanyId?: number;
}): Promise<PurchaseOrderLineRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_order_lines")
    .select(
      "canonical_id, order_type, canonical_product_id, canonical_company_id, order_date, qty, subtotal, subtotal_mxn"
    )
    .eq("order_type", "purchase")
    .order("order_date", { ascending: false });

  if (opts.from) q = q.gte("order_date", opts.from);
  if (opts.to) q = q.lte("order_date", opts.to);
  if (opts.canonicalCompanyId) q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data } = await q;
  return (data ?? []) as PurchaseOrderLineRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// listVendorPayments / listSupplierPayments — required canonical exports
// ──────────────────────────────────────────────────────────────────────────
export interface VendorPaymentRow {
  canonical_id: string;
  direction: string;
  payment_date_resolved: string | null;
  amount_mxn_resolved: number | null;
  currency_odoo: string | null;
  payment_method_odoo: string | null;
  journal_name: string | null;
  partner_name: string | null;
  counterparty_canonical_company_id: number | null;
  is_reconciled: boolean | null;
  has_odoo_record: boolean | null;
  has_sat_record: boolean | null;
}

export async function listVendorPayments(opts: {
  limit?: number;
  from?: string;
  to?: string;
  canonicalCompanyId?: number;
}): Promise<VendorPaymentRow[]> {
  const sb = getServiceClient();
  // direction='sent' = Quimibond pays out to vendors
  let q = sb
    .from("canonical_payments")
    .select(
      "canonical_id, direction, payment_date_resolved, amount_mxn_resolved, currency_odoo, payment_method_odoo, journal_name, partner_name, counterparty_canonical_company_id, is_reconciled, has_odoo_record, has_sat_record"
    )
    .eq("direction", "sent")
    .order("payment_date_resolved", { ascending: false });

  if (opts.from) q = q.gte("payment_date_resolved", opts.from);
  if (opts.to) q = q.lte("payment_date_resolved", opts.to);
  if (opts.canonicalCompanyId) q = q.eq("counterparty_canonical_company_id", opts.canonicalCompanyId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data } = await q;
  return (data ?? []) as VendorPaymentRow[];
}

/** Alias of listVendorPayments for symmetry with sales layer. */
export const listSupplierPayments = listVendorPayments;

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface PurchasesKpis {
  monthTotal: number;
  prevMonthTotal: number;
  trendPct: number;
  poCount: number;
  supplierPayable: number;
  pagosProv30d: number;
  singleSourceCount: number;
  singleSourceSpent: number;
}

async function _getPurchasesKpisRaw(): Promise<PurchasesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );
  const prevStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() - 1, 1)
  );

  const cutoff30 = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [curr, prev, ap, payments30] = await Promise.all([
    // Current month POs from canonical
    sb
      .from("canonical_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", thisStart)
      .lt("date_order", nextStart),
    // Previous month POs from canonical
    sb
      .from("canonical_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", prevStart)
      .lt("date_order", thisStart),
    // Supplier payable: open received invoices (in_invoice/in_refund direction)
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_odoo")
      .eq("direction", "received")
      .in("payment_state_odoo", ["not_paid", "partial"]),
    // Last-30d outgoing payments — replaces cfo_dashboard.pagos_prov_30d
    // (cfo_dashboard view was dropped in SP8; aggregate canonical_payments instead).
    sb
      .from("canonical_payments")
      .select("amount_mxn_resolved, amount_mxn_odoo")
      .eq("direction", "sent")
      .gte("payment_date_resolved", cutoff30),
  ]);

  const monthTotal = ((curr.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const prevMonthTotal = ((prev.data ?? []) as Array<{
    amount_total_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_total_mxn) || 0), 0);
  const supplierPayable = ((ap.data ?? []) as Array<{
    amount_residual_mxn_odoo: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_residual_mxn_odoo) || 0), 0);

  // canonical_payments amounts are signed positive for outflows in the
  // 'sent' direction, so no Math.abs needed (unlike old cfo_dashboard.pagos_prov_30d).
  const pagosProv30d = ((payments30.data ?? []) as Array<{
    amount_mxn_resolved: number | null;
    amount_mxn_odoo: number | null;
  }>).reduce(
    (a, r) =>
      a + (Number(r.amount_mxn_resolved ?? r.amount_mxn_odoo) || 0),
    0
  );

  // TODO SP6: single-source risk (supplier_concentration_herfindahl dropped;
  // replace with client-side aggregation from canonical_order_lines once SP6
  // ships a gold_supplier_concentration view). Returns zeroes for now.
  const singleSourceCount = 0;
  const singleSourceSpent = 0;

  return {
    monthTotal,
    prevMonthTotal,
    trendPct:
      prevMonthTotal > 0
        ? ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100
        : 0,
    poCount: (curr.data ?? []).length,
    supplierPayable,
    pagosProv30d,
    singleSourceCount,
    singleSourceSpent,
  };
}

// Cache KPIs for 60s — data comes from Odoo sync (1h cadence), 60s staleness is fine
export const getPurchasesKpis = unstable_cache(
  _getPurchasesKpisRaw,
  ["purchases_kpis"],
  { revalidate: 60, tags: ["purchase_orders", "canonical_invoices"] }
);

// ──────────────────────────────────────────────────────────────────────────
// Single-source risk — client-side aggregation from canonical_order_lines
// TODO SP6: ship gold_supplier_concentration MV to replace supplier_concentration_herfindahl
// ──────────────────────────────────────────────────────────────────────────
export interface SingleSourceRow {
  odoo_product_id: number;
  product_ref: string | null;
  product_name: string | null;
  top_supplier_name: string | null;
  top_supplier_company_id: number | null;
  total_spent_12m: number;
  concentration_level: string;
  herfindahl_idx: number;
  top_supplier_share_pct: number;
}

export interface SingleSourcePage {
  rows: SingleSourceRow[];
  total: number;
}

/**
 * Computes single-source risk from canonical_order_lines aggregated client-side.
 * TODO SP6: replace with gold_supplier_concentration MV once shipped. The
 * former supplier_concentration_herfindahl MV was dropped in SP1 §12.
 */
async function _getCanonicalOrderLinesForRisk(): Promise<Array<{
  canonical_company_id: number | null;
  canonical_product_id: number | null;
  subtotal_mxn: number | null;
}>> {
  const sb = getServiceClient();
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const { data } = await sb
    .from("canonical_order_lines")
    .select("canonical_company_id, canonical_product_id, subtotal_mxn")
    .eq("order_type", "purchase")
    .gte("order_date", since.toISOString().slice(0, 10))
    .gt("subtotal_mxn", 0)
    .limit(50000);
  return (data ?? []) as Array<{
    canonical_company_id: number | null;
    canonical_product_id: number | null;
    subtotal_mxn: number | null;
  }>;
}

const _getCanonicalOrderLinesForRiskCached = unstable_cache(
  _getCanonicalOrderLinesForRisk,
  ["canonical_order_lines_purchase_risk"],
  { revalidate: 300, tags: ["canonical_order_lines"] }
);

function _computeSingleSourceRows(
  rawLines: Array<{
    canonical_company_id: number | null;
    canonical_product_id: number | null;
    subtotal_mxn: number | null;
  }>
): SingleSourceRow[] {
  // Aggregate: product → { supplier → spent }
  const productSupplier = new Map<
    number,
    Map<number, number>
  >();
  for (const r of rawLines) {
    if (!r.canonical_product_id || !r.canonical_company_id) continue;
    const pid = r.canonical_product_id;
    const sid = r.canonical_company_id;
    if (!productSupplier.has(pid)) productSupplier.set(pid, new Map());
    const bySupplier = productSupplier.get(pid)!;
    bySupplier.set(sid, (bySupplier.get(sid) ?? 0) + (Number(r.subtotal_mxn) || 0));
  }

  const rows: SingleSourceRow[] = [];
  for (const [pid, bySupplier] of productSupplier.entries()) {
    const total = Array.from(bySupplier.values()).reduce((a, v) => a + v, 0);
    if (total <= 0) continue;

    const sorted = Array.from(bySupplier.entries()).sort((a, b) => b[1] - a[1]);
    const [topSupplierId, topSpent] = sorted[0];
    const topShare = (topSpent / total) * 100;

    // Herfindahl: sum of (share_i)^2
    let hhi = 0;
    for (const [, v] of bySupplier) {
      const share = v / total;
      hhi += share * share;
    }

    let concentrationLevel: string;
    if (bySupplier.size === 1) concentrationLevel = "single_source";
    else if (hhi > 0.8) concentrationLevel = "very_high";
    else if (hhi > 0.6) concentrationLevel = "high";
    else concentrationLevel = "diverse";

    rows.push({
      odoo_product_id: pid,
      product_ref: null, // Not available in canonical_order_lines MV; TODO SP6 join canonical_products
      product_name: null,
      top_supplier_name: null,
      top_supplier_company_id: topSupplierId,
      total_spent_12m: total,
      concentration_level: concentrationLevel,
      herfindahl_idx: hhi,
      top_supplier_share_pct: topShare,
    });
  }
  return rows;
}

export async function getSingleSourceRiskPage(
  params: TableParams & { level?: string[] }
): Promise<SingleSourcePage> {
  const rawLines = await _getCanonicalOrderLinesForRiskCached();
  const levels =
    params.level && params.level.length > 0
      ? params.level
      : ["single_source", "very_high", "high"];

  let all = _computeSingleSourceRows(rawLines).filter((r) =>
    levels.includes(r.concentration_level)
  );

  if (params.q) {
    const needle = params.q.toLowerCase();
    all = all.filter(
      (r) =>
        String(r.odoo_product_id).includes(needle) ||
        (r.product_ref ?? "").toLowerCase().includes(needle) ||
        (r.product_name ?? "").toLowerCase().includes(needle)
    );
  }

  const SORT_MAP: Record<string, keyof SingleSourceRow> = {
    spent: "total_spent_12m",
    herfindahl: "herfindahl_idx",
    share: "top_supplier_share_pct",
  };
  const sortKey: keyof SingleSourceRow =
    (params.sort ? SORT_MAP[params.sort] : undefined) ?? "total_spent_12m";
  const asc = params.sortDir === "asc";
  all.sort((a, b) => {
    const va = a[sortKey] as number;
    const vb = b[sortKey] as number;
    return asc ? va - vb : vb - va;
  });

  const total = all.length;
  const [start, end] = paginationRange(params.page, params.size);
  return { rows: all.slice(start, end + 1), total };
}

export async function getSingleSourceRisk(
  limit = 20
): Promise<SingleSourceRow[]> {
  const rawLines = await _getCanonicalOrderLinesForRiskCached();
  return _computeSingleSourceRows(rawLines)
    .filter((r) => ["single_source", "very_high"].includes(r.concentration_level))
    .sort((a, b) => b.total_spent_12m - a.total_spent_12m)
    .slice(0, limit);
}

export interface SingleSourceSummaryRow {
  level: string;
  spent_12m: number;
  product_count: number;
}

export async function getSingleSourceSummary(): Promise<
  SingleSourceSummaryRow[]
> {
  const rawLines = await _getCanonicalOrderLinesForRiskCached();
  const all = _computeSingleSourceRows(rawLines).filter((r) =>
    ["single_source", "very_high", "high"].includes(r.concentration_level)
  );
  const acc = new Map<string, { spent: number; count: number }>();
  for (const r of all) {
    const cur = acc.get(r.concentration_level) ?? { spent: 0, count: 0 };
    cur.spent += r.total_spent_12m;
    cur.count += 1;
    acc.set(r.concentration_level, cur);
  }
  const order = ["single_source", "very_high", "high"];
  return Array.from(acc.entries())
    .map(([level, v]) => ({
      level,
      spent_12m: v.spent,
      product_count: v.count,
    }))
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

// ──────────────────────────────────────────────────────────────────────────
// Price anomalies — purchase_price_intelligence (§12 KEEP)
// ──────────────────────────────────────────────────────────────────────────
export interface PriceAnomalyRow {
  product_ref: string | null;
  product_name: string | null;
  currency: string | null;
  last_supplier: string | null;
  last_price: number | null;
  prev_price: number | null;
  avg_price: number | null;
  price_change_pct: number | null;
  price_vs_avg_pct: number | null;
  price_flag: string;
  total_spent: number;
  last_purchase_date: string | null;
}

export interface PriceAnomaliesPage {
  rows: PriceAnomalyRow[];
  total: number;
}

const PRICE_ANOMALY_SORT_MAP: Record<string, string> = {
  spent: "total_spent",
  change: "price_change_pct",
  vs_avg: "price_vs_avg_pct",
  last_price: "last_price",
  date: "last_purchase_date",
};

export async function getPriceAnomaliesPage(
  params: TableParams & { flag?: string[] }
): Promise<PriceAnomaliesPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && PRICE_ANOMALY_SORT_MAP[params.sort]) ?? "total_spent";
  const ascending = params.sortDir === "asc";

  const flags =
    params.flag && params.flag.length > 0
      ? params.flag
      : ["price_above_avg", "price_below_avg"];

  // SP5-VERIFIED: purchase_price_intelligence retained per §12 KEEP
  let query = sb
    .from("purchase_price_intelligence")
    .select(
      "product_ref, product_name, currency, last_supplier, last_price, prev_price, avg_price, price_change_pct, price_vs_avg_pct, price_flag, total_spent, last_purchase_date",
      { count: "exact" }
    )
    .in("price_flag", flags);

  if (params.q) {
    query = query.or(
      `product_ref.ilike.%${params.q}%,product_name.ilike.%${params.q}%,last_supplier.ilike.%${params.q}%`
    );
  }
  if (params.from) query = query.gte("last_purchase_date", params.from);
  if (params.to) query = query.lte("last_purchase_date", params.to);

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<PriceAnomalyRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    currency: r.currency ?? null,
    last_supplier: r.last_supplier ?? null,
    last_price: r.last_price != null ? Number(r.last_price) : null,
    prev_price: r.prev_price != null ? Number(r.prev_price) : null,
    avg_price: r.avg_price != null ? Number(r.avg_price) : null,
    price_change_pct:
      r.price_change_pct != null ? Number(r.price_change_pct) : null,
    price_vs_avg_pct:
      r.price_vs_avg_pct != null ? Number(r.price_vs_avg_pct) : null,
    price_flag: r.price_flag ?? "—",
    total_spent: Number(r.total_spent) || 0,
    last_purchase_date: r.last_purchase_date ?? null,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getPriceAnomalies(
  limit = 30
): Promise<PriceAnomalyRow[]> {
  const sb = getServiceClient();
  // SP5-VERIFIED: purchase_price_intelligence retained per §12 KEEP
  const { data } = await sb
    .from("purchase_price_intelligence")
    .select(
      "product_ref, product_name, currency, last_supplier, last_price, prev_price, avg_price, price_change_pct, price_vs_avg_pct, price_flag, total_spent, last_purchase_date"
    )
    .in("price_flag", ["price_above_avg", "price_below_avg"])
    .order("total_spent", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as Array<Partial<PriceAnomalyRow>>).map((r) => ({
    product_ref: r.product_ref ?? null,
    product_name: r.product_name ?? null,
    currency: r.currency ?? null,
    last_supplier: r.last_supplier ?? null,
    last_price: r.last_price != null ? Number(r.last_price) : null,
    prev_price: r.prev_price != null ? Number(r.prev_price) : null,
    avg_price: r.avg_price != null ? Number(r.avg_price) : null,
    price_change_pct:
      r.price_change_pct != null ? Number(r.price_change_pct) : null,
    price_vs_avg_pct:
      r.price_vs_avg_pct != null ? Number(r.price_vs_avg_pct) : null,
    price_flag: r.price_flag ?? "—",
    total_spent: Number(r.total_spent) || 0,
    last_purchase_date: r.last_purchase_date ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Purchase orders — canonical_purchase_orders
// ──────────────────────────────────────────────────────────────────────────
export interface RecentPurchaseOrder {
  canonical_id: number;
  /** Alias for canonical_id — kept for consumer-page rowKey compatibility (Task 14 will migrate). */
  id: number;
  odoo_order_id: number | null;
  name: string | null;
  canonical_company_id: number | null;
  /** Alias for canonical_company_id — kept for consumer-page compatibility (Task 14 will migrate). */
  company_id: number | null;
  company_name: string | null;
  amount_total_mxn: number | null;
  buyer_name: string | null;
  buyer_canonical_contact_id: number | null;
  date_order: string | null;
  state: string | null;
}

export interface RecentPurchaseOrderPage {
  rows: RecentPurchaseOrder[];
  total: number;
}

const PO_SORT_MAP: Record<string, string> = {
  date: "date_order",
  amount: "amount_total_mxn",
  name: "name",
  state: "state",
};

export async function getPurchaseOrdersPage(
  params: TableParams & { state?: string[]; buyer?: string[] }
): Promise<RecentPurchaseOrderPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol = (params.sort && PO_SORT_MAP[params.sort]) ?? "date_order";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("canonical_purchase_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, amount_total_mxn, buyer_name, buyer_canonical_contact_id, date_order, state",
      { count: "exact" }
    );

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.buyer && params.buyer.length > 0) {
    query = query.in("buyer_name", params.buyer);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = (data ?? []) as Array<Omit<RecentPurchaseOrder, "company_name">>;

  // Resolve company names from canonical_companies via canonical_company_id
  const companyIds = Array.from(
    new Set(
      rows
        .map((r) => r.canonical_company_id)
        .filter((id): id is number => id != null)
    )
  );
  const nameMap = new Map<number, string>();
  if (companyIds.length > 0) {
    const { data: cdata } = await sb
      .from("canonical_companies")
      .select("id, display_name")
      .in("id", companyIds);
    for (const c of (cdata ?? []) as Array<{ id: number; display_name: string | null }>) {
      if (c.display_name) nameMap.set(c.id, c.display_name);
    }
  }

  return {
    total: count ?? rows.length,
    rows: rows.map((row) => ({
      ...row,
      id: row.canonical_id,
      company_id: row.canonical_company_id,
      company_name:
        row.canonical_company_id != null
          ? (nameMap.get(Number(row.canonical_company_id)) ?? null)
          : null,
    })),
  };
}

const _getPurchaseBuyerOptionsRaw = async (): Promise<string[]> => {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data } = await sb
    .from("canonical_purchase_orders")
    .select("buyer_name")
    .gte("date_order", since.toISOString().slice(0, 10))
    .not("buyer_name", "is", null)
    .limit(3000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ buyer_name: string | null }>) {
    if (r.buyer_name) set.add(r.buyer_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
};

// Cache buyer options — distinct buyer names change infrequently (max once/hour via Odoo sync)
export const getPurchaseBuyerOptions = unstable_cache(
  _getPurchaseBuyerOptionsRaw,
  ["purchase_buyer_options"],
  { revalidate: 300, tags: ["purchase_orders"] }
);

export async function getRecentPurchaseOrders(
  limit = 25
): Promise<RecentPurchaseOrder[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_purchase_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, amount_total_mxn, buyer_name, buyer_canonical_contact_id, date_order, state"
    )
    .order("date_order", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<Omit<RecentPurchaseOrder, "company_name">>;

  const companyIds = Array.from(
    new Set(
      rows
        .map((r) => r.canonical_company_id)
        .filter((id): id is number => id != null)
    )
  );
  const nameMap = new Map<number, string>();
  if (companyIds.length > 0) {
    const { data: cdata } = await sb
      .from("canonical_companies")
      .select("id, display_name")
      .in("id", companyIds);
    for (const c of (cdata ?? []) as Array<{ id: number; display_name: string | null }>) {
      if (c.display_name) nameMap.set(c.id, c.display_name);
    }
  }

  return rows.map((row) => ({
    ...row,
    id: row.canonical_id,
    company_id: row.canonical_company_id,
    company_name:
      row.canonical_company_id != null
        ? (nameMap.get(Number(row.canonical_company_id)) ?? null)
        : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top suppliers — client-side aggregation from canonical_order_lines
// (replaces supplier_product_matrix MV dropped in SP1 §12)
// TODO SP6: ship gold_supplier_summary MV for server-side paging
// ──────────────────────────────────────────────────────────────────────────
export interface TopSupplierRow {
  supplier_name: string;
  canonical_company_id: number | null;
  total_spent: number;
  product_count: number;
  order_count: number;
}

export interface TopSuppliersPage {
  rows: TopSupplierRow[];
  total: number;
}

/**
 * Loads all purchase canonical_order_lines (12m), cached 60s, then
 * aggregates in memory. Replaces supplier_product_matrix MV (dropped §12).
 * TODO SP6: replace with gold_supplier_summary MV.
 */
const _getAllPurchaseOrderLinesRaw = unstable_cache(
  async () => {
    const sb = getServiceClient();
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const { data } = await sb
      .from("canonical_order_lines")
      .select("canonical_company_id, canonical_product_id, subtotal_mxn")
      .eq("order_type", "purchase")
      .gte("order_date", since.toISOString().slice(0, 10))
      .gt("subtotal_mxn", 0)
      .limit(50000);
    return (data ?? []) as Array<{
      canonical_company_id: number | null;
      canonical_product_id: number | null;
      subtotal_mxn: number | null;
    }>;
  },
  ["canonical_order_lines_purchase_12m"],
  { revalidate: 60, tags: ["canonical_order_lines"] }
);

async function _getSupplierNamesMap(
  companyIds: number[]
): Promise<Map<number, string>> {
  if (companyIds.length === 0) return new Map();
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_companies")
    .select("id, display_name")
    .in("id", companyIds)
    .limit(companyIds.length);
  const map = new Map<number, string>();
  for (const c of (data ?? []) as Array<{ id: number; display_name: string | null }>) {
    if (c.display_name) map.set(c.id, c.display_name);
  }
  return map;
}

export async function getTopSuppliersPage(
  params: TableParams
): Promise<TopSuppliersPage> {
  const rows = await _getAllPurchaseOrderLinesRaw();
  const buckets = new Map<
    number,
    { spent: number; products: Set<number>; orders: number }
  >();
  for (const r of rows) {
    if (!r.canonical_company_id) continue;
    const sid = r.canonical_company_id;
    const b = buckets.get(sid) ?? {
      spent: 0,
      products: new Set<number>(),
      orders: 0,
    };
    b.spent += Number(r.subtotal_mxn) || 0;
    if (r.canonical_product_id) b.products.add(r.canonical_product_id);
    b.orders += 1;
    buckets.set(sid, b);
  }

  const companyIds = Array.from(buckets.keys());
  const nameMap = await _getSupplierNamesMap(companyIds);

  let all: TopSupplierRow[] = [...buckets.entries()].map(
    ([canonical_company_id, v]) => ({
      canonical_company_id,
      supplier_name: nameMap.get(canonical_company_id) ?? String(canonical_company_id),
      total_spent: v.spent,
      product_count: v.products.size,
      order_count: v.orders,
    })
  );

  if (params.q) {
    const needle = params.q.toLowerCase();
    all = all.filter((r) => r.supplier_name.toLowerCase().includes(needle));
  }

  const sortMap: Record<string, keyof TopSupplierRow> = {
    spent: "total_spent",
    products: "product_count",
    orders: "order_count",
    name: "supplier_name",
  };
  const sortCol: keyof TopSupplierRow =
    params.sort && sortMap[params.sort] ? sortMap[params.sort] : "total_spent";
  const asc = params.sortDir === "asc";
  all.sort((a, b) => {
    const va = a[sortCol];
    const vb = b[sortCol];
    if (typeof va === "number" && typeof vb === "number")
      return asc ? va - vb : vb - va;
    return asc
      ? String(va).localeCompare(String(vb), "es")
      : String(vb).localeCompare(String(va), "es");
  });

  const total = all.length;
  const [start, end] = paginationRange(params.page, params.size);
  return { rows: all.slice(start, end + 1), total };
}

export async function getTopSuppliers(limit = 15): Promise<TopSupplierRow[]> {
  const rows = await _getAllPurchaseOrderLinesRaw();
  const buckets = new Map<
    number,
    { spent: number; products: Set<number>; orders: number }
  >();
  for (const r of rows) {
    if (!r.canonical_company_id) continue;
    const sid = r.canonical_company_id;
    const b = buckets.get(sid) ?? {
      spent: 0,
      products: new Set<number>(),
      orders: 0,
    };
    b.spent += Number(r.subtotal_mxn) || 0;
    if (r.canonical_product_id) b.products.add(r.canonical_product_id);
    b.orders += 1;
    buckets.set(sid, b);
  }

  const topIds = [...buckets.entries()]
    .sort((a, b) => b[1].spent - a[1].spent)
    .slice(0, limit)
    .map(([id]) => id);

  const nameMap = await _getSupplierNamesMap(topIds);

  return topIds.map((canonical_company_id) => {
    const v = buckets.get(canonical_company_id)!;
    return {
      canonical_company_id,
      supplier_name: nameMap.get(canonical_company_id) ?? String(canonical_company_id),
      total_spent: v.spent,
      product_count: v.products.size,
      order_count: v.orders,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Supplier invoices — canonical_invoices (replaces invoices_unified)
// ──────────────────────────────────────────────────────────────────────────
export interface SupplierInvoiceRow {
  canonical_id: string;
  sat_uuid: string | null;
  odoo_invoice_id: number | null;
  direction: string;
  estado_sat: string | null;
  invoice_date: string | null;
  due_date_odoo: string | null;
  amount_total_mxn_resolved: number | null;
  amount_residual_mxn_odoo: number | null;
  payment_state_odoo: string | null;
  match_confidence: string | null;
  emisor_canonical_company_id: number | null;
  receptor_canonical_company_id: number | null;
}

/**
 * Get supplier invoices for a company from canonical_invoices.
 * direction='received' = invoices Quimibond received from suppliers.
 * Replaces getUnifiedInvoicesForCompany(id, { direction: 'received' })
 * which read the dropped invoices_unified MV.
 */
export async function getSupplierInvoices(
  supplierCompanyId: number
): Promise<SupplierInvoiceRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, sat_uuid, odoo_invoice_id, direction, estado_sat, invoice_date, due_date_odoo, amount_total_mxn_resolved, amount_residual_mxn_odoo, payment_state_odoo, match_confidence, emisor_canonical_company_id, receptor_canonical_company_id"
    )
    .eq("direction", "received")
    .eq("emisor_canonical_company_id", supplierCompanyId)
    .not("estado_sat", "eq", "cancelado")
    .order("invoice_date", { ascending: false })
    .limit(500);
  return (data ?? []) as SupplierInvoiceRow[];
}

// ──────────────────────────────────────────────────────────────────────────
// 69-B blacklist helpers — queries reconciliation_issues
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns the blacklist_status for a single supplier, or null if not listed.
 */
export async function getSupplierBlacklistStatus(
  supplierCompanyId: number
): Promise<string | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("metadata")
    .eq("company_id", supplierCompanyId)
    .eq("issue_type", "partner_blacklist_69b")
    .is("resolved_at", null)
    .limit(1);
  if (error) return null;
  const row = ((data ?? [])[0]) as
    | { metadata?: { blacklist_status?: string } }
    | undefined;
  return row?.metadata?.blacklist_status ?? null;
}

/**
 * Bulk fetch: returns a map of company_id → blacklist_status for all
 * suppliers that have an open 69-B issue. Avoids N+1 when rendering lists.
 */
export async function getSuppliersBlacklistMap(
  supplierCompanyIds: number[]
): Promise<Record<number, string>> {
  if (supplierCompanyIds.length === 0) return {};
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("company_id,metadata")
    .in("company_id", supplierCompanyIds)
    .eq("issue_type", "partner_blacklist_69b")
    .is("resolved_at", null);
  if (error) return {};
  const map: Record<number, string> = {};
  for (const row of (data ?? []) as Array<{
    company_id: number;
    metadata: { blacklist_status?: string };
  }>) {
    if (row.metadata?.blacklist_status) {
      map[row.company_id] = row.metadata.blacklist_status;
    }
  }
  return map;
}
