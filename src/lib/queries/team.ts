import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Team queries v2 — usa fuentes canónicas:
 * - `odoo_users` (base) — pending_activities_count + overdue_activities_count pre-calculados
 * - `odoo_employees` (base) — staff con departamento + manager
 * - `odoo_departments` (base) — departamentos Odoo con member_count
 * - `departments` (base) — departamentos QB con lead_user_id + lead_name
 * - `agent_insights` — para contar insights asignados por persona
 */

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface TeamKpis {
  employees: number;
  departments: number;
  usersWithBacklog: number;
  totalPending: number;
  totalOverdue: number;
  insightsActive: number;
}

export async function getTeamKpis(): Promise<TeamKpis> {
  const sb = getServiceClient();
  const [emp, deptOdoo, users, insights] = await Promise.all([
    sb
      .from("odoo_employees")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    sb.from("odoo_departments").select("id", { count: "exact", head: true }),
    sb
      .from("odoo_users")
      .select("pending_activities_count, overdue_activities_count"),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .in("state", ["new", "seen"]),
  ]);

  const userRows = (users.data ?? []) as Array<{
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
  }>;
  const totalPending = userRows.reduce(
    (a, r) => a + (Number(r.pending_activities_count) || 0),
    0
  );
  const totalOverdue = userRows.reduce(
    (a, r) => a + (Number(r.overdue_activities_count) || 0),
    0
  );
  const usersWithBacklog = userRows.filter(
    (r) => (r.pending_activities_count ?? 0) > 0
  ).length;

  return {
    employees: emp.count ?? 0,
    departments: deptOdoo.count ?? 0,
    usersWithBacklog,
    totalPending,
    totalOverdue,
    insightsActive: insights.count ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// User backlog — quien tiene más actividades pendientes
// ──────────────────────────────────────────────────────────────────────────
export interface UserBacklogRow {
  user_id: number;
  name: string;
  email: string | null;
  department: string | null;
  job_title: string | null;
  pending: number;
  overdue: number;
  insights_assigned: number;
}

export async function getUserBacklog(limit = 30): Promise<UserBacklogRow[]> {
  const sb = getServiceClient();
  const [users, insights] = await Promise.all([
    sb
      .from("odoo_users")
      .select(
        "odoo_user_id, name, email, department, job_title, pending_activities_count, overdue_activities_count"
      )
      .gt("pending_activities_count", 0)
      .order("pending_activities_count", { ascending: false })
      .limit(limit),
    sb
      .from("agent_insights")
      .select("assignee_user_id")
      .in("state", ["new", "seen"])
      .not("assignee_user_id", "is", null),
  ]);

  const insightsByUser = new Map<number, number>();
  for (const row of (insights.data ?? []) as Array<{
    assignee_user_id: number | null;
  }>) {
    if (!row.assignee_user_id) continue;
    insightsByUser.set(
      row.assignee_user_id,
      (insightsByUser.get(row.assignee_user_id) ?? 0) + 1
    );
  }

  return ((users.data ?? []) as Array<{
    odoo_user_id: number;
    name: string | null;
    email: string | null;
    department: string | null;
    job_title: string | null;
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
  }>).map((u) => ({
    user_id: u.odoo_user_id,
    name: u.name ?? "—",
    email: u.email,
    department: u.department,
    job_title:
      u.job_title && u.job_title !== "false" && u.job_title !== "False"
        ? u.job_title
        : null,
    pending: Number(u.pending_activities_count) || 0,
    overdue: Number(u.overdue_activities_count) || 0,
    insights_assigned: insightsByUser.get(u.odoo_user_id) ?? 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Departments con responsables
// ──────────────────────────────────────────────────────────────────────────
export interface DepartmentRow {
  id: number;
  name: string;
  lead_name: string | null;
  lead_email: string | null;
  description: string | null;
}

export async function getDepartments(): Promise<DepartmentRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("departments")
    .select("id, name, lead_name, lead_email, description, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });
  return ((data ?? []) as Array<{
    id: number;
    name: string;
    lead_name: string | null;
    lead_email: string | null;
    description: string | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    lead_name: r.lead_name,
    lead_email: r.lead_email,
    description: r.description,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Insights por departamento
// ──────────────────────────────────────────────────────────────────────────
export interface InsightsByDepartment {
  department: string;
  total_active: number;
  critical: number;
  high: number;
}

export async function getInsightsByDepartment(): Promise<
  InsightsByDepartment[]
> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("agent_insights")
    .select("assignee_department, severity")
    .in("state", ["new", "seen"])
    .not("assignee_department", "is", null);

  const buckets = new Map<
    string,
    { total: number; critical: number; high: number }
  >();
  for (const row of (data ?? []) as Array<{
    assignee_department: string | null;
    severity: string | null;
  }>) {
    if (!row.assignee_department) continue;
    const b = buckets.get(row.assignee_department) ?? {
      total: 0,
      critical: 0,
      high: 0,
    };
    b.total += 1;
    if (row.severity === "critical") b.critical += 1;
    if (row.severity === "high") b.high += 1;
    buckets.set(row.assignee_department, b);
  }
  return [...buckets.entries()]
    .map(([department, v]) => ({
      department,
      total_active: v.total,
      critical: v.critical,
      high: v.high,
    }))
    .sort((a, b) => b.total_active - a.total_active);
}

// ──────────────────────────────────────────────────────────────────────────
// Empleados activos
// ──────────────────────────────────────────────────────────────────────────
export interface EmployeeRow {
  id: number;
  name: string | null;
  work_email: string | null;
  department_name: string | null;
  job_title: string | null;
  manager_name: string | null;
}

export async function getEmployees(limit = 100): Promise<EmployeeRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_employees")
    .select(
      "id, name, work_email, department_name, job_title, manager_name, is_active"
    )
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(limit);
  return ((data ?? []) as Array<Partial<EmployeeRow>>).map((r) => ({
    id: Number(r.id) || 0,
    name: r.name ?? null,
    work_email: r.work_email ?? null,
    department_name: r.department_name ?? null,
    job_title: r.job_title ?? null,
    manager_name: r.manager_name ?? null,
  }));
}
