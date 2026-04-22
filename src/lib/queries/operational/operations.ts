import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * Operations queries SP5 — canonical sources:
 * - `ops_delivery_health_weekly` (MV) — SP5-VERIFIED: §12 KEEP; OTD semanal con avg_lead_days
 * - `canonical_deliveries` (MV) — replaces odoo_deliveries
 * - `canonical_manufacturing` (MV) — replaces odoo_manufacturing
 * - `canonical_inventory` (view) — replaces odoo_orderpoints
 * - `inventory_velocity` (MV) — SP5-VERIFIED: §12 KEEP
 * - `dead_stock_analysis` (MV) — SP5-VERIFIED: §12 KEEP
 */

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface OperationsKpis {
  otdLatestPct: number | null;
  otdAvg4w: number | null;
  totalCompleted4w: number;
  lateOpen: number;
  pendingDeliveries: number;
  mfgInProgress: number;
  mfgToClose: number;
  avgLeadDays: number | null;
}

export async function getOperationsKpis(): Promise<OperationsKpis> {
  const sb = getServiceClient();
  const [otd, late, pending, mfgProgress, mfgToClose] = await Promise.all([
    sb
      .from("ops_delivery_health_weekly") // SP5-VERIFIED: §12 KEEP — ops KPI MV
      .select("otd_pct, total_completed, avg_lead_days, week_start")
      .order("week_start", { ascending: false })
      .limit(4),
    sb
      .from("canonical_deliveries")
      .select("canonical_id", { count: "exact", head: true })
      .eq("is_late", true),
    sb
      .from("canonical_deliveries")
      .select("canonical_id", { count: "exact", head: true })
      .in("state", ["assigned", "confirmed", "waiting"]),
    sb
      .from("canonical_manufacturing")
      .select("canonical_id", { count: "exact", head: true })
      .in("state", ["confirmed", "progress", "draft"]),
    sb
      .from("canonical_manufacturing")
      .select("canonical_id", { count: "exact", head: true })
      .eq("state", "to_close"),
  ]);

  const otdRows = (otd.data ?? []) as Array<{
    otd_pct: number | null;
    total_completed: number | null;
    avg_lead_days: number | null;
  }>;
  const otdLatest = otdRows[0]?.otd_pct ?? null;
  const validOtd = otdRows.filter((r) => r.otd_pct != null);
  const otdAvg4w =
    validOtd.length > 0
      ? validOtd.reduce((a, r) => a + Number(r.otd_pct), 0) / validOtd.length
      : null;
  const totalCompleted4w = otdRows.reduce(
    (a, r) => a + (Number(r.total_completed) || 0),
    0
  );
  const validLead = otdRows.filter((r) => r.avg_lead_days != null);
  const avgLead =
    validLead.length > 0
      ? validLead.reduce((a, r) => a + Number(r.avg_lead_days), 0) /
        validLead.length
      : null;

  return {
    otdLatestPct: otdLatest != null ? Number(otdLatest) : null,
    otdAvg4w,
    totalCompleted4w,
    lateOpen: late.count ?? 0,
    pendingDeliveries: pending.count ?? 0,
    mfgInProgress: mfgProgress.count ?? 0,
    mfgToClose: mfgToClose.count ?? 0,
    avgLeadDays: avgLead,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Weekly trend (last 12 weeks)
// ──────────────────────────────────────────────────────────────────────────
export interface WeeklyTrendPoint {
  week: string; // YYYY-MM-DD (week start)
  total_completed: number;
  on_time: number;
  late: number;
  otd_pct: number;
  avg_lead_days: number | null;
}

export async function getWeeklyTrend(weeks = 12): Promise<WeeklyTrendPoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("ops_delivery_health_weekly") // SP5-VERIFIED: §12 KEEP — weekly OTD trend MV
    .select("week_start, total_completed, on_time, late, otd_pct, avg_lead_days")
    .order("week_start", { ascending: false })
    .limit(weeks);
  return ((data ?? []) as Array<{
    week_start: string;
    total_completed: number | null;
    on_time: number | null;
    late: number | null;
    otd_pct: number | null;
    avg_lead_days: number | null;
  }>)
    .map((r) => ({
      week: r.week_start,
      total_completed: Number(r.total_completed) || 0,
      on_time: Number(r.on_time) || 0,
      late: Number(r.late) || 0,
      otd_pct: Number(r.otd_pct) || 0,
      avg_lead_days:
        r.avg_lead_days != null ? Number(r.avg_lead_days) : null,
    }))
    .reverse();
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries — canonical_deliveries
// Note: canonical_deliveries has canonical_company_id (FK to canonical_companies)
// but no embedded company_name — consumers should resolve name from canonical_company_id if needed.
// ──────────────────────────────────────────────────────────────────────────
export interface LateDeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  canonical_company_id: number | null;
  /** @alias canonical_company_id — back-compat for consumer pages */
  company_id: number | null;
  company_name: string | null; // null — resolved by caller if needed
  scheduled_date: string | null;
  state: string | null;
  origin: string | null;
}

export async function getLateDeliveries(
  limit = 30
): Promise<LateDeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_deliveries")
    .select(
      "canonical_id, name, picking_type_code, canonical_company_id, scheduled_date, state, origin"
    )
    .eq("is_late", true)
    .order("scheduled_date", { ascending: true })
    .limit(limit);

  return ((data ?? []) as Array<{
    canonical_id: number;
    name: string | null;
    picking_type_code: string | null;
    canonical_company_id: number | null;
    scheduled_date: string | null;
    state: string | null;
    origin: string | null;
  }>).map((r) => ({
    id: r.canonical_id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    canonical_company_id: r.canonical_company_id,
    company_id: r.canonical_company_id, // back-compat alias
    company_name: null,
    scheduled_date: r.scheduled_date,
    state: r.state,
    origin: r.origin,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Pending deliveries (assigned/confirmed/waiting)
// ──────────────────────────────────────────────────────────────────────────
export interface PendingDeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  canonical_company_id: number | null;
  /** @alias canonical_company_id — back-compat for consumer pages */
  company_id: number | null;
  company_name: string | null; // null — resolved by caller if needed
  scheduled_date: string | null;
  state: string | null;
  is_late: boolean | null;
}

export async function getPendingDeliveries(
  limit = 30
): Promise<PendingDeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_deliveries")
    .select(
      "canonical_id, name, picking_type_code, canonical_company_id, scheduled_date, state, is_late"
    )
    .in("state", ["assigned", "confirmed", "waiting"])
    .order("scheduled_date", { ascending: true })
    .limit(limit);

  return ((data ?? []) as Array<{
    canonical_id: number;
    name: string | null;
    picking_type_code: string | null;
    canonical_company_id: number | null;
    scheduled_date: string | null;
    state: string | null;
    is_late: boolean | null;
  }>).map((r) => ({
    id: r.canonical_id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    canonical_company_id: r.canonical_company_id,
    company_id: r.canonical_company_id, // back-compat alias
    company_name: null,
    scheduled_date: r.scheduled_date,
    state: r.state,
    is_late: r.is_late,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries unified page (filterable by state, date range, late flag)
// ──────────────────────────────────────────────────────────────────────────
export interface DeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  canonical_company_id: number | null;
  /** @alias canonical_company_id — back-compat for consumer pages */
  company_id: number | null;
  company_name: string | null; // null — resolved by caller if needed
  scheduled_date: string | null;
  date_done: string | null;
  state: string | null;
  origin: string | null;
  is_late: boolean | null;
}

export interface DeliveryPage {
  rows: DeliveryRow[];
  total: number;
}

const DELIVERY_SORT_MAP: Record<string, string> = {
  scheduled: "scheduled_date",
  done: "date_done",
  name: "name",
  state: "state",
};

export async function getDeliveriesPage(
  params: TableParams & {
    state?: string[];
    picking_type?: string[];
    onlyLate?: boolean;
  }
): Promise<DeliveryPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);

  const sortCol =
    (params.sort && DELIVERY_SORT_MAP[params.sort]) ?? "scheduled_date";
  const ascending = params.sortDir === "asc" || !params.sort;

  let query = sb
    .from("canonical_deliveries")
    .select(
      "canonical_id, name, picking_type_code, canonical_company_id, scheduled_date, date_done, state, origin, is_late",
      { count: "exact" }
    );

  if (params.onlyLate) query = query.eq("is_late", true);

  if (params.state && params.state.length > 0) {
    query = query.in("state", params.state);
  }
  if (params.picking_type && params.picking_type.length > 0) {
    query = query.in("picking_type_code", params.picking_type);
  }
  if (params.from) query = query.gte("scheduled_date", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("scheduled_date", next);
  }
  if (params.q) {
    query = query.or(`name.ilike.%${params.q}%,origin.ilike.%${params.q}%`);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<{
    canonical_id: number;
    name: string | null;
    picking_type_code: string | null;
    canonical_company_id: number | null;
    scheduled_date: string | null;
    date_done: string | null;
    state: string | null;
    origin: string | null;
    is_late: boolean | null;
  }>).map((r) => ({
    id: r.canonical_id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    canonical_company_id: r.canonical_company_id,
    company_id: r.canonical_company_id, // back-compat alias
    company_name: null as string | null,
    scheduled_date: r.scheduled_date,
    date_done: r.date_done ? String(r.date_done) : null,
    state: r.state,
    origin: r.origin,
    is_late: r.is_late,
  }));

  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// Manufacturing — canonical_manufacturing
// ──────────────────────────────────────────────────────────────────────────
export interface ManufacturingRow {
  id: number;
  name: string | null;
  product_name: string | null;
  qty_planned: number;
  qty_produced: number;
  state: string | null;
  date_start: string | null;
  date_finished: string | null;
  assigned_user: string | null;
  origin: string | null;
}

export interface ManufacturingPage {
  rows: ManufacturingRow[];
  total: number;
}

const MFG_SORT_MAP: Record<string, string> = {
  start: "date_start",
  finish: "date_finished",
  name: "name",
  qty_planned: "qty_planned",
  qty_produced: "qty_produced",
};

export async function getManufacturingPage(
  params: TableParams & { state?: string[]; assigned?: string[] }
): Promise<ManufacturingPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol = (params.sort && MFG_SORT_MAP[params.sort]) ?? "date_start";
  const ascending = params.sortDir === "asc" || !params.sort;

  const states =
    params.state && params.state.length > 0
      ? params.state
      : ["confirmed", "progress", "to_close"];

  let query = sb
    .from("canonical_manufacturing")
    .select(
      "canonical_id, name, product_name, qty_planned, qty_produced, state, date_start, date_finished, assigned_user, origin",
      { count: "exact" }
    )
    .in("state", states);

  if (params.q) {
    query = query.or(
      `name.ilike.%${params.q}%,product_name.ilike.%${params.q}%,origin.ilike.%${params.q}%`
    );
  }
  if (params.from) query = query.gte("date_start", params.from);
  if (params.to) {
    const next = endOfDay(params.to);
    if (next) query = query.lt("date_start", next);
  }
  if (params.assigned && params.assigned.length > 0) {
    query = query.in("assigned_user", params.assigned);
  }

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  const rows = ((data ?? []) as Array<Partial<ManufacturingRow> & { canonical_id?: number }>).map((r) => ({
    id: Number(r.id ?? (r as { canonical_id?: number }).canonical_id) || 0,
    name: r.name ?? null,
    product_name: r.product_name ?? null,
    qty_planned: Number(r.qty_planned) || 0,
    qty_produced: Number(r.qty_produced) || 0,
    state: r.state ?? null,
    date_start: r.date_start ?? null,
    date_finished: r.date_finished ?? null,
    assigned_user: r.assigned_user ?? null,
    origin: r.origin ?? null,
  }));

  return { rows, total: count ?? rows.length };
}

export async function getManufacturingAssigneeOptions(): Promise<string[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_manufacturing")
    .select("assigned_user")
    .not("assigned_user", "is", null)
    .limit(2000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ assigned_user: string | null }>) {
    if (r.assigned_user) set.add(r.assigned_user);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

export async function getActiveManufacturing(
  limit = 30
): Promise<ManufacturingRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_manufacturing")
    .select(
      "canonical_id, name, product_name, qty_planned, qty_produced, state, date_start, date_finished, assigned_user, origin"
    )
    .in("state", ["confirmed", "progress", "to_close"])
    .order("date_start", { ascending: true })
    .limit(limit);
  return ((data ?? []) as Array<Partial<ManufacturingRow> & { canonical_id?: number }>).map((r) => ({
    id: Number(r.id ?? (r as { canonical_id?: number }).canonical_id) || 0,
    name: r.name ?? null,
    product_name: r.product_name ?? null,
    qty_planned: Number(r.qty_planned) || 0,
    qty_produced: Number(r.qty_produced) || 0,
    state: r.state ?? null,
    date_start: r.date_start ?? null,
    date_finished: r.date_finished ?? null,
    assigned_user: r.assigned_user ?? null,
    origin: r.origin ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Required SP5 exports: listDeliveries, listManufacturingOrders, listInventory
// fetchInventoryVelocity, fetchDeadStockAnalysis
// ──────────────────────────────────────────────────────────────────────────

export async function listDeliveries(opts: { limit?: number; state?: string[]; onlyLate?: boolean } = {}) {
  const sb = getServiceClient();
  const { limit = 50, state, onlyLate } = opts;

  let query = sb
    .from("canonical_deliveries")
    .select("canonical_id, name, picking_type_code, canonical_company_id, scheduled_date, date_done, state, origin, is_late, lead_time_days");

  if (onlyLate) query = query.eq("is_late", true);
  if (state && state.length > 0) query = query.in("state", state);

  const { data } = await query
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []) as Array<{
    canonical_id: number;
    name: string | null;
    picking_type_code: string | null;
    canonical_company_id: number | null;
    scheduled_date: string | null;
    date_done: string | null;
    state: string | null;
    origin: string | null;
    is_late: boolean | null;
    lead_time_days: number | null;
  }>;
}

export async function listManufacturingOrders(opts: { limit?: number; state?: string[] } = {}) {
  const sb = getServiceClient();
  const { limit = 50, state } = opts;
  const states = state && state.length > 0 ? state : ["confirmed", "progress", "to_close", "draft", "done"];

  const { data } = await sb
    .from("canonical_manufacturing")
    .select("canonical_id, name, product_name, qty_planned, qty_produced, yield_pct, state, date_start, date_finished, assigned_user, origin, cycle_time_days")
    .in("state", states)
    .order("date_start", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []) as Array<{
    canonical_id: number;
    name: string | null;
    product_name: string | null;
    qty_planned: number | null;
    qty_produced: number | null;
    yield_pct: number | null;
    state: string | null;
    date_start: string | null;
    date_finished: string | null;
    assigned_user: string | null;
    origin: string | null;
    cycle_time_days: number | null;
  }>;
}

export async function listInventory(opts: { limit?: number; onlyStockout?: boolean } = {}) {
  const sb = getServiceClient();
  const { limit = 100, onlyStockout } = opts;

  let query = sb
    .from("canonical_inventory")
    .select("canonical_product_id, internal_ref, display_name, stock_qty, available_qty, reserved_qty, reorder_min, reorder_max, is_stockout, warehouse_name, location_name, qty_to_order, qty_forecast, trigger_type");

  if (onlyStockout) query = query.eq("is_stockout", true);

  const { data } = await query
    .order("display_name", { ascending: true })
    .limit(limit);

  return (data ?? []) as Array<{
    canonical_product_id: number;
    internal_ref: string | null;
    display_name: string | null;
    stock_qty: number | null;
    available_qty: number | null;
    reserved_qty: number | null;
    reorder_min: number | null;
    reorder_max: number | null;
    is_stockout: boolean | null;
    warehouse_name: string | null;
    location_name: string | null;
    qty_to_order: number | null;
    qty_forecast: number | null;
    trigger_type: string | null;
  }>;
}

export async function fetchInventoryVelocity(limit = 100) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("inventory_velocity") // SP5-VERIFIED: §12 KEEP — velocity analytics MV
    .select("*")
    .order("velocity_score", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as Record<string, unknown>[];
}

export async function fetchDeadStockAnalysis(limit = 100) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("dead_stock_analysis") // SP5-VERIFIED: §12 KEEP — dead stock analytics MV
    .select("*")
    .limit(limit);
  return (data ?? []) as Record<string, unknown>[];
}
