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
    sb
      .from("odoo_employees")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    sb.from("odoo_departments").select("id", { count: "exact", head: true }),
    sb
      .from("odoo_activities")
      .select("id", { count: "exact", head: true })
      .eq("is_overdue", true),
    sb.from("odoo_activities").select("id", { count: "exact", head: true }),
  ]);
  return {
    employees: emp.count ?? 0,
    departments: dept.count ?? 0,
    activitiesOverdue: overdue.count ?? 0,
    activitiesPending: pending.count ?? 0,
  };
}

export interface EmployeeActivityLoad {
  user_name: string;
  activities_count: number;
  overdue_count: number;
}

/**
 * Carga de actividades por usuario asignado.
 * Usa columna real `assigned_to` y flag `is_overdue`.
 */
export async function getTopActivityLoad(
  limit = 10
): Promise<EmployeeActivityLoad[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_activities")
    .select("assigned_to, is_overdue")
    .not("assigned_to", "is", null);
  const rows = (data ?? []) as Array<{
    assigned_to: string | null;
    is_overdue: boolean | null;
  }>;
  const buckets = new Map<string, { total: number; overdue: number }>();
  for (const r of rows) {
    if (!r.assigned_to) continue;
    const b = buckets.get(r.assigned_to) ?? { total: 0, overdue: 0 };
    b.total += 1;
    if (r.is_overdue) b.overdue += 1;
    buckets.set(r.assigned_to, b);
  }
  return [...buckets.entries()]
    .map(([user_name, { total, overdue }]) => ({
      user_name,
      activities_count: total,
      overdue_count: overdue,
    }))
    .sort(
      (a, b) =>
        b.overdue_count - a.overdue_count ||
        b.activities_count - a.activities_count
    )
    .slice(0, limit);
}
