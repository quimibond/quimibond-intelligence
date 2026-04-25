import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getSelfCompanyIds, pgInList } from "../_shared/_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * Sales queries v3 — canonical layer (SP5 Task 8, broad sweep pass):
 * - `canonical_sale_orders` — golden sale order record (MDM-resolved)
 * - `canonical_order_lines` (order_type='sale') — golden sale order lines
 * - `canonical_crm_leads` — golden CRM leads
 * - `canonical_contacts` (contact_type LIKE 'internal_%') — salesperson metadata
 * - `gold_pl_statement` — monthly P&L aggregates (replaces pl_estado_resultados)
 * - `gold_revenue_monthly` — per-company monthly revenue (replaces monthly_revenue_by_company)
 * - `gold_company_360` — company 360 view (replaces company_profile, company_profile_sat)
 * - `canonical_invoices` — canonical invoice records (replaces invoices_unified)
 *
 * §12 drop-list reads fully eliminated in this pass.
 *
 * Schema notes:
 * - gold_pl_statement.total_income is stored NEGATIVE (credit side); use Math.abs() for display.
 * - gold_revenue_monthly grand-total rows have canonical_company_id IS NULL.
 * - gold_company_360 revenue field is revenue_90d_mxn (not revenue_90d).
 * - gold_company_360 has no margin_12m / margin_pct_12m — margin comes from canonical_order_lines.
 * - company_profile_sat fields (total_invoiced_sat, total_invoiced_sat_ytd) have no direct
 *   equivalent in gold_company_360; stubbed as TODO SP6.
 * - customer_margin_analysis has no canonical equivalent; stubbed as TODO SP6.
 */

// SP5-VERIFIED: client_reorder_predictions retained per §12 KEEP
// SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP

// ──────────────────────────────────────────────────────────────────────────
// Internal helper: canonical_companies.is_internal=true IDs
// ──────────────────────────────────────────────────────────────────────────

let _selfCanonicalIdsCache: number[] | null = null;
async function getSelfCanonicalCompanyIds(): Promise<number[]> {
  if (_selfCanonicalIdsCache) return _selfCanonicalIdsCache;
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_companies")
    .select("id")
    .eq("is_internal", true);
  _selfCanonicalIdsCache = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
  return _selfCanonicalIdsCache;
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs principales del mes
// ──────────────────────────────────────────────────────────────────────────
export interface SalesKpis {
  ingresosMes: number;
  ingresosMesAnt: number;
  ingresosMomPct: number;
  ingresosYoy: number;
  ingresosYoyPct: number;
  ma3m: number;
  utilidadOperativaMes: number;
  pedidosMes: number;
  ticketPromedio: number;
  topSalesperson: string | null;
  topSalespersonAmount: number;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * P&L + revenue KPIs for the current month.
 * Reads gold_pl_statement (replaces pl_estado_resultados) and
 * gold_revenue_monthly (replaces monthly_revenue_by_company).
 */
export async function getSalesKpis(): Promise<SalesKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const currKey = monthKey(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prev);
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const yearAgoKey = monthKey(yearAgo);

  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const selfIds = await getSelfCanonicalCompanyIds();

  // gold_pl_statement — period col is "YYYY-MM" string.
  // total_income is negative (accounting credit); abs = revenue.
  // net_income is the bottom-line (≈ utilidad neta).
  // No utilidad_operativa equivalent — use net_income as proxy.
  const [pl, monthlyRev, salesOrders] = await Promise.all([
    sb
      .from("gold_pl_statement")
      .select("period, total_income, net_income")
      .order("period", { ascending: false })
      .limit(26),
    // Grand-total rows: canonical_company_id IS NULL
    // column: month_start (YYYY-MM-DD), resolved_mxn is best source
    sb
      .from("gold_revenue_monthly")
      .select("month_start, resolved_mxn, odoo_mxn")
      .is("canonical_company_id", null)
      .order("month_start", { ascending: false })
      .limit(12),
    sb
      .from("canonical_sale_orders")
      .select("amount_total_mxn, salesperson_name")
      .gte("date_order", thisStart)
      .lt("date_order", nextStart)
      .neq("state", "cancel")
      .not("canonical_company_id", "in", pgInList(selfIds)),
  ]);

  // P&L lookups — filter out bad/test years
  const plRows = ((pl.data ?? []) as Array<{
    period: string | null;
    total_income: number | null;
    net_income: number | null;
  }>).filter((r) => {
    if (!r.period) return false;
    const y = Number(r.period.split("-")[0]);
    return y >= 2020 && y <= 2030;
  });

  // gold_pl_statement.period is "YYYY-MM"; match against monthKey
  const curr = plRows.find((r) => r.period?.slice(0, 7) === currKey);
  const prevRow = plRows.find((r) => r.period?.slice(0, 7) === prevKey);
  const yearAgoRow = plRows.find((r) => r.period?.slice(0, 7) === yearAgoKey);

  // total_income is stored as negative; abs = revenue
  const ingresosMes = Math.abs(Number(curr?.total_income) || 0);
  const ingresosMesAnt = Math.abs(Number(prevRow?.total_income) || 0);
  const ingresosYoy = Math.abs(Number(yearAgoRow?.total_income) || 0);
  const utilidadOperativaMes = Number(curr?.net_income) || 0;
  const ingresosMomPct =
    ingresosMesAnt > 0
      ? ((ingresosMes - ingresosMesAnt) / ingresosMesAnt) * 100
      : 0;
  const ingresosYoyPct =
    ingresosYoy > 0 ? ((ingresosMes - ingresosYoy) / ingresosYoy) * 100 : 0;

  // MA3m from gold_revenue_monthly grand-total rows (IS NULL = grand total)
  // ma_3m no longer comes from MV — compute client-side rolling 3-month average
  const monthlyRows = ((monthlyRev.data ?? []) as Array<{
    month_start: string | null;
    resolved_mxn: number | null;
    odoo_mxn: number | null;
  }>).filter((r) => {
    if (!r.month_start) return false;
    const y = Number(r.month_start.split("-")[0]);
    return y >= 2020 && y <= 2030;
  });

  // Find the 3 most recent months and compute average
  const recentMonths = monthlyRows.slice(0, 3);
  const ma3m =
    recentMonths.length > 0
      ? recentMonths.reduce(
          (a, r) => a + Math.abs(Number(r.resolved_mxn ?? r.odoo_mxn ?? 0)),
          0
        ) / recentMonths.length
      : 0;

  // Sale orders del mes (canonical) → top vendedor
  const orderRows = (salesOrders.data ?? []) as Array<{
    amount_total_mxn: number | null;
    salesperson_name: string | null;
  }>;
  const orderTotal = orderRows.reduce(
    (a, r) => a + (Number(r.amount_total_mxn) || 0),
    0
  );
  const salespeople: Record<string, number> = {};
  for (const r of orderRows) {
    if (!r.salesperson_name) continue;
    salespeople[r.salesperson_name] =
      (salespeople[r.salesperson_name] ?? 0) +
      (Number(r.amount_total_mxn) || 0);
  }
  const topSp = Object.entries(salespeople).sort((a, b) => b[1] - a[1])[0];

  return {
    ingresosMes,
    ingresosMesAnt,
    ingresosMomPct,
    ingresosYoy,
    ingresosYoyPct,
    ma3m,
    utilidadOperativaMes,
    pedidosMes: orderRows.length,
    ticketPromedio: orderRows.length > 0 ? orderTotal / orderRows.length : 0,
    topSalesperson: topSp?.[0] ?? null,
    topSalespersonAmount: topSp?.[1] ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Revenue trend con MA3m
// ──────────────────────────────────────────────────────────────────────────
export interface RevenueTrendPoint {
  period: string;
  revenue: number;
  ma3m: number;
}

/**
 * Serie mensual de ingresos para el chart de /ventas.
 *
 * Default path: gold_pl_statement.total_income (abs) — replaces pl_estado_resultados.
 * Bounds path: canonical_invoices WHERE direction=issued — replaces invoices_unified.
 *
 * gold_pl_statement.total_income is stored as NEGATIVE (accounting credit side).
 * ma3m computed client-side with rolling 3-month window.
 */
export async function getSalesRevenueTrend(
  months = 12,
  bounds?: { from?: string | null; to?: string | null }
): Promise<RevenueTrendPoint[]> {
  const sb = getServiceClient();

  // Bounds path: aggregate from canonical_invoices (replaces invoices_unified)
  // canonical_invoices fields: direction, invoice_date, amount_total_mxn_resolved,
  //   estado_sat, tipo_comprobante, receptor_canonical_company_id, emisor_canonical_company_id
  if (bounds?.from || bounds?.to) {
    // canonical_invoices exposes amount_total_mxn_resolved (single canonical
    // MXN total). The legacy fallback on `amount_total_mxn` was dead because
    // that column does not exist on canonical_invoices — selecting it 400s
    // the entire query and silently empties the trend chart.
    let q = sb
      .from("canonical_invoices")
      .select("invoice_date, amount_total_mxn_resolved")
      .eq("direction", "issued")
      .eq("estado_sat", "vigente");
    if (bounds.from) q = q.gte("invoice_date", bounds.from);
    if (bounds.to) q = q.lt("invoice_date", bounds.to);
    const { data: rows } = await q;

    const map = new Map<string, number>();
    for (const r of (rows ?? []) as Array<{
      invoice_date: string | null;
      amount_total_mxn_resolved: number | null;
    }>) {
      if (!r.invoice_date) continue;
      const d = new Date(r.invoice_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const amount = Number(r.amount_total_mxn_resolved) || 0;
      map.set(key, (map.get(key) ?? 0) + amount);
    }

    const sorted = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, revenue]) => ({ period, revenue }));

    return sorted.map((r, i) => {
      const window = sorted.slice(Math.max(0, i - 2), i + 1);
      const ma3m =
        window.length > 0
          ? window.reduce((s, w) => s + w.revenue, 0) / window.length
          : 0;
      return { period: r.period, revenue: r.revenue, ma3m };
    });
  }

  // Default path: gold_pl_statement grand-total monthly series
  // Fetch months+2 extra for ma3m context of the oldest window point
  const { data } = await sb
    .from("gold_pl_statement")
    .select("period, total_income")
    .order("period", { ascending: false })
    .limit(months + 4);

  const rows = ((data ?? []) as Array<{
    period: string | null;
    total_income: number | null;
  }>)
    .filter((r) => {
      if (!r.period) return false;
      const y = Number(r.period.split("-")[0]);
      return y >= 2020 && y <= 2030;
    })
    .map((r) => ({
      period: r.period!.slice(0, 7),
      // total_income is negative (credit); abs = revenue
      revenue: Math.abs(Number(r.total_income) || 0),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const points: RevenueTrendPoint[] = rows.map((r, i) => {
    const window = rows.slice(Math.max(0, i - 2), i + 1);
    const ma3m =
      window.length > 0
        ? window.reduce((s, w) => s + w.revenue, 0) / window.length
        : 0;
    return { period: r.period, revenue: r.revenue, ma3m };
  });

  return points.slice(-months);
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder risk — clientes que deberían haber comprado y no
// ──────────────────────────────────────────────────────────────────────────
export interface ReorderRiskRow {
  company_id: number;
  company_name: string | null;
  tier: string | null;
  status: string;
  avg_cycle_days: number | null;
  days_since_last: number | null;
  days_overdue_reorder: number | null;
  avg_order_value: number | null;
  total_revenue: number | null;
  salesperson_name: string | null;
  top_product_ref: string | null;
  predicted_next_order: string | null;
}

export interface ReorderRiskPage {
  rows: ReorderRiskRow[];
  total: number;
}

const REORDER_SORT_MAP: Record<string, string> = {
  revenue: "total_revenue",
  days_overdue: "days_overdue_reorder",
  avg_cycle: "avg_cycle_days",
  days_since: "days_since_last",
  avg_order: "avg_order_value",
  company: "company_name",
};

// SP5-VERIFIED: client_reorder_predictions retained per §12 KEEP
export async function getReorderRiskPage(
  params: TableParams & { status?: string[]; tier?: string[] }
): Promise<ReorderRiskPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && REORDER_SORT_MAP[params.sort]) ?? "total_revenue";
  const ascending = params.sortDir === "asc";

  const statuses =
    params.status && params.status.length > 0
      ? params.status
      : ["overdue", "at_risk", "critical"];

  let query = sb
    .from("client_reorder_predictions") // SP5-VERIFIED: client_reorder_predictions retained per §12 KEEP
    .select(
      "company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name, top_product_ref, predicted_next_order",
      { count: "exact" }
    )
    .in("reorder_status", statuses)
    .not("company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("company_name", `%${params.q}%`);
  if (params.tier && params.tier.length > 0) {
    query = query.in("tier", params.tier);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<{
    company_id: number;
    company_name: string | null;
    tier: string | null;
    reorder_status: string;
    avg_cycle_days: number | null;
    days_since_last: number | null;
    days_overdue_reorder: number | null;
    avg_order_value: number | null;
    total_revenue: number | null;
    salesperson_name: string | null;
    top_product_ref: string | null;
    predicted_next_order: string | null;
  }>).map((r) => ({
    company_id: r.company_id,
    company_name: r.company_name,
    tier: r.tier,
    status: r.reorder_status,
    avg_cycle_days: r.avg_cycle_days,
    days_since_last: r.days_since_last,
    days_overdue_reorder: r.days_overdue_reorder,
    avg_order_value: r.avg_order_value,
    total_revenue: r.total_revenue,
    salesperson_name: r.salesperson_name,
    top_product_ref: r.top_product_ref,
    predicted_next_order: r.predicted_next_order,
  }));

  return { rows, total: count ?? rows.length };
}

// SP5-VERIFIED: client_reorder_predictions retained per §12 KEEP
export async function getReorderRisk(
  limit = 30
): Promise<ReorderRiskRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();
  const { data } = await sb
    .from("client_reorder_predictions") // SP5-VERIFIED: client_reorder_predictions retained per §12 KEEP
    .select(
      "company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name, top_product_ref, predicted_next_order"
    )
    .in("reorder_status", ["overdue", "at_risk", "critical"])
    .not("company_id", "in", pgInList(selfIds))
    .order("total_revenue", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{
    company_id: number;
    company_name: string | null;
    tier: string | null;
    reorder_status: string;
    avg_cycle_days: number | null;
    days_since_last: number | null;
    days_overdue_reorder: number | null;
    avg_order_value: number | null;
    total_revenue: number | null;
    salesperson_name: string | null;
    top_product_ref: string | null;
    predicted_next_order: string | null;
  }>).map((r) => ({
    company_id: r.company_id,
    company_name: r.company_name,
    tier: r.tier,
    status: r.reorder_status,
    avg_cycle_days: r.avg_cycle_days,
    days_since_last: r.days_since_last,
    days_overdue_reorder: r.days_overdue_reorder,
    avg_order_value: r.avg_order_value,
    total_revenue: r.total_revenue,
    salesperson_name: r.salesperson_name,
    top_product_ref: r.top_product_ref,
    predicted_next_order: r.predicted_next_order,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top customers
// ──────────────────────────────────────────────────────────────────────────
export interface TopCustomerRow {
  company_id: number;
  company_name: string;
  revenue_90d: number;
  margin_12m: number | null;
  margin_pct_12m: number | null;         // TODO SP6: customer_margin_analysis.margin_pct_12m not in gold_company_360
  overhead_factor_pct: number;           // Overhead % del revenue (global)
  adjusted_margin_pct_12m: number | null; // TODO SP6: derived from margin_pct_12m above
  total_revenue_lifetime: number;
  // SAT fiscal LTV — TODO SP6: company_profile_sat.total_invoiced_sat not in gold_company_360
  total_invoiced_sat: number | null;
  total_invoiced_sat_ytd: number | null;
}

export interface TopCustomersPage {
  rows: TopCustomerRow[];
  total: number;
}

const TOP_CUSTOMER_SORT_MAP: Record<string, string> = {
  revenue_90d: "revenue_90d_mxn",
  revenue_total: "lifetime_value_mxn",
  name: "display_name",
};

/**
 * Top customers paginated.
 *
 * Default path: gold_company_360 WHERE is_customer=true, ordered by revenue_90d_mxn.
 *   Replaces company_profile (§12 drop-list).
 *
 * Period-filter path: canonical_invoices aggregated client-side by receptor_canonical_company_id.
 *   Replaces invoices_unified (§12 drop-list).
 *
 * Margin fields (margin_12m, margin_pct_12m): no canonical equivalent in gold_company_360.
 *   TODO SP6: wire canonical_order_lines aggregation for margin once SP6 ships.
 *
 * SAT fiscal LTV fields (total_invoiced_sat, total_invoiced_sat_ytd): from company_profile_sat
 *   (§12 drop-list). No direct equivalent in gold_company_360.
 *   TODO SP6: expose via gold_company_360 enrichment or separate canonical view.
 *
 * SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP.
 */
export async function getTopCustomersPage(
  params: TableParams & { from?: string | null; to?: string | null }
): Promise<TopCustomersPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  // ── Path B: period-filtered via canonical_invoices ─────────────────────────
  // Replaces invoices_unified (§12 drop-list).
  // canonical_invoices exposes amount_total_mxn_resolved as the canonical
  // MXN total. Legacy fallback on amount_total_mxn was dead — selecting it
  // 400s the entire query and silently emptied the table.
  if (params.from || params.to) {
    let q = sb
      .from("canonical_invoices")
      .select("receptor_canonical_company_id, emisor_rfc, receptor_nombre, amount_total_mxn_resolved")
      .eq("direction", "issued")
      .eq("estado_sat", "vigente")
      .not("receptor_canonical_company_id", "is", null);
    if (params.from) q = q.gte("invoice_date", params.from);
    if (params.to) q = q.lt("invoice_date", params.to);

    const { data: invRows } = await q;

    // Aggregate in-memory by canonical_company_id
    const byCompany = new Map<
      number,
      { id: number; name: string; revenue: number }
    >();
    for (const r of (invRows ?? []) as Array<{
      receptor_canonical_company_id: number | null;
      receptor_nombre: string | null;
      amount_total_mxn_resolved: number | null;
    }>) {
      if (r.receptor_canonical_company_id == null) continue;
      if (selfIds.includes(r.receptor_canonical_company_id)) continue;
      const existing = byCompany.get(r.receptor_canonical_company_id) ?? {
        id: r.receptor_canonical_company_id,
        name: r.receptor_nombre ?? "",
        revenue: 0,
      };
      const amount = Number(r.amount_total_mxn_resolved) || 0;
      existing.revenue += amount;
      byCompany.set(r.receptor_canonical_company_id, existing);
    }

    // Apply search filter client-side
    let sorted = [...byCompany.values()].sort((a, b) => b.revenue - a.revenue);
    if (params.q) {
      const q_lower = params.q.toLowerCase();
      sorted = sorted.filter((r) => r.name.toLowerCase().includes(q_lower));
    }
    const totalCount = sorted.length;
    const offset = (params.page ?? 0) * (params.size ?? 25);
    const slice = sorted.slice(offset, offset + (params.size ?? 25));

    if (slice.length === 0) return { rows: [], total: totalCount };

    // overhead_factor_12m — SP5-VERIFIED: retained per §12 KEEP
    const overheadRes = await sb
      .from("overhead_factor_12m") // SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP
      .select("overhead_factor_pct")
      .maybeSingle();
    const overheadFactor = Number(
      (overheadRes.data as { overhead_factor_pct: number | null } | null)
        ?.overhead_factor_pct ?? 0,
    );

    const rows: TopCustomerRow[] = slice.map((r) => ({
      company_id: r.id,
      company_name: r.name,
      revenue_90d: r.revenue, // In period mode, represents period revenue
      total_revenue_lifetime: r.revenue,
      // TODO SP6: customer_margin_analysis.margin_12m not in gold_company_360
      margin_12m: null,
      // TODO SP6: customer_margin_analysis.margin_pct_12m not in gold_company_360
      margin_pct_12m: null,
      overhead_factor_pct: overheadFactor,
      // TODO SP6: adjusted margin unavailable without margin_pct_12m
      adjusted_margin_pct_12m: null,
      // TODO SP6: company_profile_sat.total_invoiced_sat not in gold_company_360
      total_invoiced_sat: null,
      total_invoiced_sat_ytd: null,
    }));

    return { rows, total: totalCount };
  }

  // ── Path A: default 90d window from gold_company_360 ─────────────────────
  // Replaces company_profile (§12 drop-list)
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && TOP_CUSTOMER_SORT_MAP[params.sort]) ?? "revenue_90d_mxn";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("gold_company_360")
    .select("canonical_company_id, display_name, revenue_90d_mxn, lifetime_value_mxn", {
      count: "exact",
    })
    .eq("is_customer", true)
    .gt("revenue_90d_mxn", 0)
    .not("canonical_company_id", "in", pgInList(selfIds));

  if (params.q) query = query.ilike("display_name", `%${params.q}%`);

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const baseRows = (data ?? []) as Array<{
    canonical_company_id: number;
    display_name: string | null;
    revenue_90d_mxn: number | null;
    lifetime_value_mxn: number | null;
  }>;

  if (baseRows.length === 0) {
    return { rows: [], total: count ?? 0 };
  }

  // overhead_factor_12m — SP5-VERIFIED: retained per §12 KEEP
  const overheadRes = await sb
    .from("overhead_factor_12m") // SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP
    .select("overhead_factor_pct")
    .maybeSingle();
  const overheadFactor = Number(
    (overheadRes.data as { overhead_factor_pct: number | null } | null)
      ?.overhead_factor_pct ?? 0,
  );

  const rows: TopCustomerRow[] = baseRows.map((r) => ({
    company_id: r.canonical_company_id,
    company_name: r.display_name ?? "",
    revenue_90d: Number(r.revenue_90d_mxn) || 0,
    total_revenue_lifetime: Number(r.lifetime_value_mxn) || 0,
    // TODO SP6: customer_margin_analysis.margin_12m not in gold_company_360
    margin_12m: null,
    // TODO SP6: customer_margin_analysis.margin_pct_12m not in gold_company_360
    margin_pct_12m: null,
    overhead_factor_pct: overheadFactor,
    // TODO SP6: adjusted margin unavailable without margin_pct_12m
    adjusted_margin_pct_12m: null,
    // TODO SP6: company_profile_sat.total_invoiced_sat not in gold_company_360
    total_invoiced_sat: null,
    total_invoiced_sat_ytd: null,
  }));

  return { rows, total: count ?? rows.length };
}

/**
 * Top customers list (simplified, no pagination).
 *
 * Reads gold_company_360 (replaces company_profile and company_profile_sat — §12 drop-list).
 * SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP.
 */
export async function getTopCustomers(limit = 15): Promise<TopCustomerRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCompanyIds();

  // gold_company_360 replaces company_profile (§12 drop-list)
  const [{ data }, overheadRes] = await Promise.all([
    sb
      .from("gold_company_360")
      .select("canonical_company_id, display_name, revenue_90d_mxn, lifetime_value_mxn")
      .eq("is_customer", true)
      .gt("revenue_90d_mxn", 0)
      .not("canonical_company_id", "in", pgInList(selfIds))
      .order("revenue_90d_mxn", { ascending: false })
      .limit(limit),
    sb
      .from("overhead_factor_12m") // SP5-VERIFIED: overhead_factor_12m retained per §12 KEEP
      .select("overhead_factor_pct")
      .maybeSingle(),
  ]);

  const baseRows = (data ?? []) as Array<{
    canonical_company_id: number;
    display_name: string | null;
    revenue_90d_mxn: number | null;
    lifetime_value_mxn: number | null;
  }>;
  if (baseRows.length === 0) return [];

  const overheadFactor = Number(
    (overheadRes.data as { overhead_factor_pct: number | null } | null)
      ?.overhead_factor_pct ?? 0,
  );

  return baseRows.map((r) => ({
    company_id: r.canonical_company_id,
    company_name: r.display_name ?? "",
    revenue_90d: Number(r.revenue_90d_mxn) || 0,
    total_revenue_lifetime: Number(r.lifetime_value_mxn) || 0,
    // TODO SP6: customer_margin_analysis.margin_12m not in gold_company_360
    margin_12m: null,
    // TODO SP6: customer_margin_analysis.margin_pct_12m not in gold_company_360
    margin_pct_12m: null,
    overhead_factor_pct: overheadFactor,
    // TODO SP6: adjusted margin unavailable without margin_pct_12m
    adjusted_margin_pct_12m: null,
    // TODO SP6: company_profile_sat.total_invoiced_sat not in gold_company_360
    total_invoiced_sat: null,
    total_invoiced_sat_ytd: null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Top salespeople del mes — canonical_sale_orders
// ──────────────────────────────────────────────────────────────────────────
export interface SalespersonRow {
  name: string;
  total_amount: number;
  order_count: number;
}

export async function getTopSalespeople(): Promise<SalespersonRow[]> {
  const sb = getServiceClient();
  const now = new Date();
  const thisStart = monthStart(new Date(now.getFullYear(), now.getMonth(), 1));
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const selfIds = await getSelfCanonicalCompanyIds();
  const { data } = await sb
    .from("canonical_sale_orders")
    .select("salesperson_name, amount_total_mxn")
    .gte("date_order", thisStart)
    .lt("date_order", nextStart)
    .neq("state", "cancel")
    .not("salesperson_name", "is", null)
    .not("canonical_company_id", "in", pgInList(selfIds));

  const buckets = new Map<string, { total: number; count: number }>();
  for (const r of (data ?? []) as Array<{
    salesperson_name: string | null;
    amount_total_mxn: number | null;
  }>) {
    if (!r.salesperson_name) continue;
    const b = buckets.get(r.salesperson_name) ?? { total: 0, count: 0 };
    b.total += Number(r.amount_total_mxn) || 0;
    b.count += 1;
    buckets.set(r.salesperson_name, b);
  }

  return [...buckets.entries()]
    .map(([name, v]) => ({
      name,
      total_amount: v.total,
      order_count: v.count,
    }))
    .sort((a, b) => b.total_amount - a.total_amount);
}

// ──────────────────────────────────────────────────────────────────────────
// Recent sale orders — canonical_sale_orders
// ──────────────────────────────────────────────────────────────────────────

/**
 * Shape returned by getSaleOrdersPage / getRecentSaleOrders.
 * `id` is an alias for `odoo_order_id` for back-compat with consumer pages.
 * `canonical_id` is always present for canonical layer consumers.
 */
export interface RecentSaleOrder {
  canonical_id: number;
  id: number;                  // back-compat alias = odoo_order_id
  name: string | null;
  canonical_company_id: number | null;
  company_id: number | null;   // back-compat alias = canonical_company_id
  company_name: string | null;
  amount_total_mxn: number | null;
  salesperson_name: string | null;
  date_order: string | null;
  state: string | null;
}

export interface RecentSaleOrderPage {
  rows: RecentSaleOrder[];
  total: number;
}

const SALE_ORDER_SORT_MAP: Record<string, string> = {
  date: "date_order",
  amount: "amount_total_mxn",
  name: "name",
  state: "state",
};

/**
 * Sale orders paginadas + filtrables para la tabla de ventas.
 * Reads from canonical_sale_orders.
 */
export async function getSaleOrdersPage(
  params: TableParams & { state?: string[]; salesperson?: string[] }
): Promise<RecentSaleOrderPage> {
  const sb = getServiceClient();
  const selfIds = await getSelfCanonicalCompanyIds();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol =
    (params.sort && SALE_ORDER_SORT_MAP[params.sort]) ?? "date_order";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("canonical_sale_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, amount_total_mxn, salesperson_name, date_order, state",
      { count: "exact" }
    )
    .not("canonical_company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.salesperson && params.salesperson.length > 0) {
    query = query.in("salesperson_name", params.salesperson);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rawRows = (data ?? []) as Array<{
    canonical_id: number;
    odoo_order_id: number;
    name: string | null;
    canonical_company_id: number | null;
    amount_total_mxn: number | null;
    salesperson_name: string | null;
    date_order: string | null;
    state: string | null;
  }>;

  // Resolve company names via canonical_companies
  const canonicalCompanyIds = rawRows
    .map((r) => r.canonical_company_id)
    .filter((id): id is number => id != null);
  const uniqueIds = Array.from(new Set(canonicalCompanyIds));
  const companyNameMap = new Map<number, string>();
  if (uniqueIds.length > 0) {
    const { data: ccRows } = await sb
      .from("canonical_companies")
      .select("id, display_name")
      .in("id", uniqueIds);
    for (const cc of (ccRows ?? []) as Array<{ id: number; display_name: string | null }>) {
      if (cc.display_name) companyNameMap.set(cc.id, cc.display_name);
    }
  }

  return {
    total: count ?? rawRows.length,
    rows: rawRows.map((row) => ({
      canonical_id: row.canonical_id,
      id: row.odoo_order_id,          // back-compat alias
      name: row.name,
      canonical_company_id: row.canonical_company_id,
      company_id: row.canonical_company_id,  // back-compat alias
      company_name: row.canonical_company_id != null
        ? (companyNameMap.get(row.canonical_company_id) ?? null)
        : null,
      amount_total_mxn: row.amount_total_mxn,
      salesperson_name: row.salesperson_name,
      date_order: row.date_order,
      state: row.state,
    })),
  };
}

export async function getSaleOrderSalespeopleOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data } = await sb
    .from("canonical_sale_orders")
    .select("salesperson_name")
    .gte("date_order", since.toISOString().slice(0, 10))
    .not("salesperson_name", "is", null)
    .limit(3000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ salesperson_name: string | null }>) {
    if (r.salesperson_name) set.add(r.salesperson_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Serie temporal de sale orders para el chart stacked area. */
export interface SaleOrdersTimelineBucket {
  week: string;
  draft: number;
  sent: number;
  sale: number;
  done: number;
  cancel: number;
}

function isoMondayKey(date: Date): string {
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + diffToMonday
    )
  );
  return monday.toISOString().slice(0, 10);
}

export async function getSaleOrdersTimeline(params: {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  state?: string[];
  salesperson?: string[];
  maxRows?: number;
}): Promise<SaleOrdersTimelineBucket[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCanonicalCompanyIds();

  let query = sb
    .from("canonical_sale_orders")
    .select("amount_total_mxn, date_order, state")
    .not("canonical_company_id", "in", pgInList(selfIds));

  if (params.from) query = query.gte("date_order", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_order", next);
  }
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.salesperson && params.salesperson.length > 0) {
    query = query.in("salesperson_name", params.salesperson);
  }

  const { data } = await query
    .order("date_order", { ascending: true })
    .limit(params.maxRows ?? 2000);

  const buckets = new Map<string, SaleOrdersTimelineBucket>();
  for (const r of (data ?? []) as Array<{
    amount_total_mxn: number | null;
    date_order: string | null;
    state: string | null;
  }>) {
    if (!r.date_order) continue;
    const d = new Date(r.date_order);
    if (Number.isNaN(d.getTime())) continue;
    const key = isoMondayKey(d);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        week: key,
        draft: 0,
        sent: 0,
        sale: 0,
        done: 0,
        cancel: 0,
      };
      buckets.set(key, bucket);
    }
    const amt = Number(r.amount_total_mxn) || 0;
    const s = (r.state ?? "draft") as keyof SaleOrdersTimelineBucket;
    if (s !== "week" && s in bucket) {
      bucket[s] = (bucket[s] as number) + amt;
    }
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.week.localeCompare(b.week)
  );
}

export async function getRecentSaleOrders(
  limit = 25
): Promise<RecentSaleOrder[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCanonicalCompanyIds();
  const { data } = await sb
    .from("canonical_sale_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, amount_total_mxn, salesperson_name, date_order, state"
    )
    .not("canonical_company_id", "in", pgInList(selfIds))
    .order("date_order", { ascending: false })
    .limit(limit);

  const rawRows = (data ?? []) as Array<{
    canonical_id: number;
    odoo_order_id: number;
    name: string | null;
    canonical_company_id: number | null;
    amount_total_mxn: number | null;
    salesperson_name: string | null;
    date_order: string | null;
    state: string | null;
  }>;

  const canonicalCompanyIds = rawRows
    .map((r) => r.canonical_company_id)
    .filter((id): id is number => id != null);
  const uniqueIds = Array.from(new Set(canonicalCompanyIds));
  const companyNameMap = new Map<number, string>();
  if (uniqueIds.length > 0) {
    const { data: ccRows } = await sb
      .from("canonical_companies")
      .select("id, display_name")
      .in("id", uniqueIds);
    for (const cc of (ccRows ?? []) as Array<{ id: number; display_name: string | null }>) {
      if (cc.display_name) companyNameMap.set(cc.id, cc.display_name);
    }
  }

  return rawRows.map((row) => ({
    canonical_id: row.canonical_id,
    id: row.odoo_order_id,
    name: row.name,
    canonical_company_id: row.canonical_company_id,
    company_id: row.canonical_company_id,  // back-compat alias
    company_name: row.canonical_company_id != null
      ? (companyNameMap.get(row.canonical_company_id) ?? null)
      : null,
    amount_total_mxn: row.amount_total_mxn,
    salesperson_name: row.salesperson_name,
    date_order: row.date_order,
    state: row.state,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// New canonical exports (SP5 Task 8 required)
// ──────────────────────────────────────────────────────────────────────────

/**
 * List canonical sale orders with optional filters.
 * Returns raw canonical rows (canonical_id is PK).
 */
export async function listSaleOrders(opts: {
  limit?: number;
  from?: string | null;
  to?: string | null;
  state?: string[];
  salesperson?: string[];
} = {}): Promise<Array<{
  canonical_id: number;
  odoo_order_id: number;
  name: string | null;
  canonical_company_id: number | null;
  salesperson_name: string | null;
  salesperson_canonical_contact_id: number | null;
  amount_total_mxn: number | null;
  date_order: string | null;
  state: string | null;
  currency: string | null;
  margin: number | null;
  margin_percent: number | null;
}>> {
  const sb = getServiceClient();
  const selfIds = await getSelfCanonicalCompanyIds();

  let query = sb
    .from("canonical_sale_orders")
    .select(
      "canonical_id, odoo_order_id, name, canonical_company_id, salesperson_name, salesperson_canonical_contact_id, amount_total_mxn, date_order, state, currency, margin, margin_percent"
    )
    .not("canonical_company_id", "in", pgInList(selfIds))
    .order("date_order", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.from) query = query.gte("date_order", opts.from);
  if (opts.to) query = query.lt("date_order", opts.to);
  if (opts.state && opts.state.length > 0) query = query.in("state", opts.state);
  if (opts.salesperson && opts.salesperson.length > 0) {
    query = query.in("salesperson_name", opts.salesperson);
  }

  const { data } = await query;
  return (data ?? []) as typeof listSaleOrders extends (...args: unknown[]) => Promise<infer R> ? R : never;
}

/**
 * List canonical sale order lines (order_type='sale').
 */
export async function listSaleOrderLines(opts: {
  limit?: number;
  from?: string | null;
  to?: string | null;
  canonical_company_id?: number;
  canonical_product_id?: number;
} = {}): Promise<Array<{
  canonical_id: number;
  odoo_line_id: number;
  order_name: string | null;
  order_type: string;
  order_date: string | null;
  order_state: string | null;
  canonical_company_id: number | null;
  canonical_product_id: number | null;
  product_name: string | null;
  product_ref: string | null;
  qty: number | null;
  subtotal_mxn: number | null;
  salesperson_name: string | null;
}>> {
  const sb = getServiceClient();

  let query = sb
    .from("canonical_order_lines")
    .select(
      "canonical_id, odoo_line_id, order_name, order_type, order_date, order_state, canonical_company_id, canonical_product_id, product_name, product_ref, qty, subtotal_mxn, salesperson_name"
    )
    .eq("order_type", "sale")
    .order("order_date", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.from) query = query.gte("order_date", opts.from);
  if (opts.to) query = query.lt("order_date", opts.to);
  if (opts.canonical_company_id != null) {
    query = query.eq("canonical_company_id", opts.canonical_company_id);
  }
  if (opts.canonical_product_id != null) {
    query = query.eq("canonical_product_id", opts.canonical_product_id);
  }

  const { data } = await query;
  return (data ?? []) as typeof listSaleOrderLines extends (...args: unknown[]) => Promise<infer R> ? R : never;
}

/**
 * List canonical CRM leads.
 */
export async function listCrmLeads(opts: {
  limit?: number;
  active?: boolean;
  stage?: string[];
  canonical_company_id?: number;
} = {}): Promise<Array<{
  canonical_id: number;
  odoo_lead_id: number;
  name: string | null;
  canonical_company_id: number | null;
  lead_type: string | null;
  stage: string | null;
  expected_revenue: number | null;
  probability: number | null;
  date_deadline: string | null;
  days_open: number | null;
  assigned_user: string | null;
  assignee_canonical_contact_id: number | null;
  active: boolean | null;
}>> {
  const sb = getServiceClient();

  let query = sb
    .from("canonical_crm_leads")
    .select(
      "canonical_id, odoo_lead_id, name, canonical_company_id, lead_type, stage, expected_revenue, probability, date_deadline, days_open, assigned_user, assignee_canonical_contact_id, active"
    )
    .order("create_date", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.active != null) query = query.eq("active", opts.active);
  if (opts.stage && opts.stage.length > 0) query = query.in("stage", opts.stage);
  if (opts.canonical_company_id != null) {
    query = query.eq("canonical_company_id", opts.canonical_company_id);
  }

  const { data } = await query;
  return (data ?? []) as typeof listCrmLeads extends (...args: unknown[]) => Promise<infer R> ? R : never;
}

/**
 * Sales aggregated by salesperson for a given month window.
 * Uses canonical_sale_orders.
 */
export async function salesBySalesperson(opts: {
  from?: string | null;
  to?: string | null;
  limit?: number;
} = {}): Promise<SalespersonRow[]> {
  const sb = getServiceClient();
  const selfIds = await getSelfCanonicalCompanyIds();

  let query = sb
    .from("canonical_sale_orders")
    .select("salesperson_name, amount_total_mxn")
    .neq("state", "cancel")
    .not("salesperson_name", "is", null)
    .not("canonical_company_id", "in", pgInList(selfIds))
    .limit(opts.limit ?? 5000);

  if (opts.from) query = query.gte("date_order", opts.from);
  if (opts.to) query = query.lt("date_order", opts.to);

  const { data } = await query;

  const buckets = new Map<string, { total: number; count: number }>();
  for (const r of (data ?? []) as Array<{
    salesperson_name: string | null;
    amount_total_mxn: number | null;
  }>) {
    if (!r.salesperson_name) continue;
    const b = buckets.get(r.salesperson_name) ?? { total: 0, count: 0 };
    b.total += Number(r.amount_total_mxn) || 0;
    b.count += 1;
    buckets.set(r.salesperson_name, b);
  }

  return [...buckets.entries()]
    .map(([name, v]) => ({
      name,
      total_amount: v.total,
      order_count: v.count,
    }))
    .sort((a, b) => b.total_amount - a.total_amount);
}

/**
 * Fetch internal salesperson metadata from canonical_contacts.
 * Replaces the old odoo_users lookup.
 * Returns contacts with contact_type LIKE 'internal_%'.
 */
export interface SalespersonMeta {
  id: number;
  display_name: string | null;
  primary_email: string | null;
  contact_type: string;
  role: string | null;
  department: string | null;
  odoo_user_id: number | null;
}

export async function fetchSalespersonMetadata(): Promise<SalespersonMeta[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_contacts")
    .select("id, display_name, primary_email, contact_type, role, department, odoo_user_id")
    .like("contact_type", "internal_%")
    .order("display_name", { ascending: true });

  return ((data ?? []) as Array<{
    id: number;
    display_name: string | null;
    primary_email: string | null;
    contact_type: string;
    role: string | null;
    department: string | null;
    odoo_user_id: number | null;
  }>).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    primary_email: r.primary_email,
    contact_type: r.contact_type,
    role: r.role,
    department: r.department,
    odoo_user_id: r.odoo_user_id,
  }));
}
