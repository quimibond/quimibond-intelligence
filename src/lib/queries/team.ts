import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface TeamKpis {
  employees: number;
  departments: number;
  activitiesOverdue: number;
  activitiesPending: number;
}

export async function getTeamKpis(): Promise<TeamKpis> {
  const sb = getServiceClient();
  const [emp, dept, overdue, pending] = await Promise.all([
    sb.from("odoo_employees").select("id", { count: "exact", head: true }),
    sb.from("odoo_departments").select("id", { count: "exact", head: true }),
    sb
      .from("odoo_activities")
      .select("id", { count: "exact", head: true })
      .lt("date_deadline", new Date().toISOString().slice(0, 10)),
    sb
      .from("odoo_activities")
      .select("id", { count: "exact", head: true }),
  ]);
  return {
    employees: emp.count ?? 0,
    departments: dept.count ?? 0,
    activitiesOverdue: overdue.count ?? 0,
    activitiesPending: pending.count ?? 0,
  };
}

export interface EmployeeActivityLoad {
  user_name: string | null;
  activities_count: number;
  overdue_count: number;
}

export async function getTopActivityLoad(
  limit = 10
): Promise<EmployeeActivityLoad[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_activities")
    .select("user_name, date_deadline")
    .not("user_name", "is", null);
  const rows = (data ?? []) as Array<{
    user_name: string | null;
    date_deadline: string | null;
  }>;
  const today = new Date().toISOString().slice(0, 10);
  const buckets = new Map<string, { total: number; overdue: number }>();
  for (const r of rows) {
    if (!r.user_name) continue;
    const b = buckets.get(r.user_name) ?? { total: 0, overdue: 0 };
    b.total += 1;
    if (r.date_deadline && r.date_deadline < today) b.overdue += 1;
    buckets.set(r.user_name, b);
  }
  return [...buckets.entries()]
    .map(([user_name, { total, overdue }]) => ({
      user_name,
      activities_count: total,
      overdue_count: overdue,
    }))
    .sort((a, b) => b.overdue_count - a.overdue_count || b.activities_count - a.activities_count)
    .slice(0, limit);
}
