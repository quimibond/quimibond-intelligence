import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { joinedCompanyName } from "./_helpers";

export interface OperationsKpis {
  otdPct: number | null;
  lateDeliveries: number;
  mfgActive: number;
  avgLeadTimeDays: number | null;
}

export async function getOperationsKpis(): Promise<OperationsKpis> {
  const sb = getServiceClient();
  const [otd, late, mfg, lead] = await Promise.all([
    sb
      .from("ops_delivery_health_weekly")
      .select("otd_pct, week")
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("odoo_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("is_late", true),
    sb
      .from("odoo_manufacturing")
      .select("id", { count: "exact", head: true })
      .in("state", ["confirmed", "progress"]),
    sb.from("odoo_deliveries").select("lead_time_days"),
  ]);
  const leadRows = (lead.data ?? []) as Array<{
    lead_time_days: number | null;
  }>;
  const leadValues = leadRows
    .map((r) => Number(r.lead_time_days))
    .filter((v) => !Number.isNaN(v) && v > 0);
  const avgLead =
    leadValues.length > 0
      ? leadValues.reduce((a, v) => a + v, 0) / leadValues.length
      : null;
  return {
    otdPct: (otd.data as { otd_pct: number | null } | null)?.otd_pct ?? null,
    lateDeliveries: late.count ?? 0,
    mfgActive: mfg.count ?? 0,
    avgLeadTimeDays: avgLead,
  };
}

export interface DeliveryRow {
  id: number | string;
  name: string | null;
  picking_type_code: string | null;
  company_id: number | string | null;
  company_name: string | null;
  scheduled_date: string | null;
  date_done: string | null;
  state: string | null;
  is_late: boolean | null;
  lead_time_days: number | null;
}

export async function getRecentDeliveries(
  limit = 25
): Promise<DeliveryRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_deliveries")
    .select(
      "id, name, picking_type_code, company_id, scheduled_date, date_done, state, is_late, lead_time_days, companies:company_id(name)"
    )
    .order("scheduled_date", { ascending: false })
    .limit(limit);
  type Raw = Omit<DeliveryRow, "company_name"> & { companies: unknown };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    name: r.name,
    picking_type_code: r.picking_type_code,
    company_id: r.company_id,
    company_name: joinedCompanyName(r.companies),
    scheduled_date: r.scheduled_date,
    date_done: r.date_done,
    state: r.state,
    is_late: r.is_late,
    lead_time_days: r.lead_time_days,
  }));
}
