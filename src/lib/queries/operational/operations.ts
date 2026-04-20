import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "../_shared/_helpers";
import {
  endOfDay,
  paginationRange,
  type TableParams,
} from "../_shared/table-params";

/**
 * Operations queries v2 — usa views canónicas:
 * - `ops_delivery_health_weekly` (MV) — OTD semanal con avg_lead_days
 * - `odoo_deliveries` — entregas (con is_late, scheduled_date, date_done)
 * - `odoo_manufacturing` — órdenes de producción
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
      .from("ops_delivery_health_weekly")
      .select("otd_pct, total_completed, avg_lead_days, week_start")
      .order("week_start", { ascending: false })
      .limit(4),
    sb
      .from("odoo_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("is_late", true),
    sb
      .from("odoo_deliveries")
      .select("id", { count: "exact", head: true })
      .in("state", ["assigned", "confirmed", "waiting"]),
    sb
      .from("odoo_manufacturing")
      .select("id", { count: "exact", head: true })
      .in("state", ["confirmed", "progress", "draft"]),
    sb
      .from("odoo_manufacturing")
      .select("id", { count: "exact", head: true })
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
    .from("ops_delivery_health_weekly")
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
// Late deliveries (still open)
// ──────────────────────────────────────────────────────────────────────────
export interface LateDeliveryRow {
  id: number;
  name: string | null;
  picking_type_code: string | null;
  company_id: number | null;
  company_name: string | null;
  scheduled_date: string | null;
  state: string | null;
  origin: string | null;
}

export async function getLateDeliveries(
  limit = 30
): Promise<LateDeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_deliveries")
    .select(
      "id, name, picking_type_code, company_id, scheduled_date, state, origin, companies:company_id(name)"
    )
    .eq("is_late", true)
    .order("scheduled_date", { ascending: true })
    .limit(limit);

  type Raw = Omit<LateDeliveryRow, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    company_id: r.company_id,
    company_name: joinedCompanyName(r.companies),
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
  company_id: number | null;
  company_name: string | null;
  scheduled_date: string | null;
  state: string | null;
  is_late: boolean | null;
}

export async function getPendingDeliveries(
  limit = 30
): Promise<PendingDeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_deliveries")
    .select(
      "id, name, picking_type_code, company_id, scheduled_date, state, is_late, companies:company_id(name)"
    )
    .in("state", ["assigned", "confirmed", "waiting"])
    .order("scheduled_date", { ascending: true })
    .limit(limit);

  type Raw = Omit<PendingDeliveryRow, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    company_id: r.company_id,
    company_name: joinedCompanyName(r.companies),
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
  company_id: number | null;
  company_name: string | null;
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
    .from("odoo_deliveries")
    .select(
      "id, name, picking_type_code, company_id, scheduled_date, date_done, state, origin, is_late, companies:company_id(name)",
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

  type Raw = Omit<DeliveryRow, "company_name"> & { companies: unknown };
  const rows = ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    company_id: r.company_id,
    company_name: joinedCompanyName(r.companies),
    scheduled_date: r.scheduled_date,
    date_done: r.date_done,
    state: r.state,
    origin: r.origin,
    is_late: r.is_late,
  }));

  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// Manufacturing in progress
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
    .from("odoo_manufacturing")
    .select(
      "id, name, product_name, qty_planned, qty_produced, state, date_start, date_finished, assigned_user, origin",
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

  const rows = ((data ?? []) as Array<Partial<ManufacturingRow>>).map((r) => ({
    id: Number(r.id) || 0,
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
    .from("odoo_manufacturing")
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
    .from("odoo_manufacturing")
    .select(
      "id, name, product_name, qty_planned, qty_produced, state, date_start, date_finished, assigned_user, origin"
    )
    .in("state", ["confirmed", "progress", "to_close"])
    .order("date_start", { ascending: true })
    .limit(limit);
  return ((data ?? []) as Array<Partial<ManufacturingRow>>).map((r) => ({
    id: Number(r.id) || 0,
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
