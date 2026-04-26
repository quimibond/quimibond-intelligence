import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Team queries SP5 — canonical sources:
 * - `canonical_employees` (view over canonical_contacts WHERE contact_type LIKE 'internal_%')
 *   replaces odoo_employees + odoo_users + person_unified
 * - `canonical_contacts` with contact_type LIKE 'internal_%' (same underlying data)
 * - `agent_insights` — assignee_user_id (integer odoo_user_id)
 *   mapped to canonical_employees.odoo_user_id for workload counting
 *
 * NOTE: agent_insights uses `assignee_user_id` (odoo integer FK), NOT a canonical_contact id.
 * fetchEmployeeWorkload maps canonical_employees.odoo_user_id → assignee_user_id for the join.
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
  const [emp, empAll, insights] = await Promise.all([
    sb
      .from("canonical_employees")
      .select("contact_id", { count: "exact", head: true })
      .eq("is_active", true),
    sb
      .from("canonical_employees")
      .select("department_name, pending_activities_count, overdue_activities_count")
      .eq("is_active", true),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .in("state", ["new", "seen"]),
  ]);

  const empRows = (empAll.data ?? []) as Array<{
    department_name: string | null;
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
  }>;

  // Count distinct departments
  const deptSet = new Set<string>();
  for (const r of empRows) {
    if (r.department_name) deptSet.add(r.department_name);
  }

  const totalPending = empRows.reduce(
    (a, r) => a + (Number(r.pending_activities_count) || 0),
    0
  );
  const totalOverdue = empRows.reduce(
    (a, r) => a + (Number(r.overdue_activities_count) || 0),
    0
  );
  const usersWithBacklog = empRows.filter(
    (r) => (r.pending_activities_count ?? 0) > 0
  ).length;

  return {
    employees: emp.count ?? 0,
    departments: deptSet.size,
    usersWithBacklog,
    totalPending,
    totalOverdue,
    insightsActive: insights.count ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// User backlog — who has the most pending activities
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
  const [employees, insights] = await Promise.all([
    sb
      .from("canonical_employees")
      .select(
        "contact_id, odoo_user_id, display_name, primary_email, department_name, job_title, pending_activities_count, overdue_activities_count"
      )
      .eq("is_active", true)
      .gt("pending_activities_count", 0)
      .order("pending_activities_count", { ascending: false })
      .limit(limit),
    sb
      .from("agent_insights")
      .select("assignee_user_id")
      .in("state", ["new", "seen"])
      .not("assignee_user_id", "is", null),
  ]);

  // agent_insights.assignee_user_id = odoo integer user id
  // canonical_employees.odoo_user_id = same odoo user id
  const insightsByOdooUser = new Map<number, number>();
  for (const row of (insights.data ?? []) as Array<{
    assignee_user_id: number | null;
  }>) {
    if (!row.assignee_user_id) continue;
    insightsByOdooUser.set(
      row.assignee_user_id,
      (insightsByOdooUser.get(row.assignee_user_id) ?? 0) + 1
    );
  }

  return ((employees.data ?? []) as Array<{
    contact_id: number;
    odoo_user_id: number | null;
    display_name: string | null;
    primary_email: string | null;
    department_name: string | null;
    job_title: string | null;
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
  }>).map((u) => ({
    user_id: u.odoo_user_id ?? u.contact_id,
    name: u.display_name ?? "—",
    email: u.primary_email,
    department: u.department_name,
    job_title:
      u.job_title && u.job_title !== "false" && u.job_title !== "False"
        ? u.job_title
        : null,
    pending: Number(u.pending_activities_count) || 0,
    overdue: Number(u.overdue_activities_count) || 0,
    insights_assigned: u.odoo_user_id
      ? (insightsByOdooUser.get(u.odoo_user_id) ?? 0)
      : 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Departments — derived from canonical_employees.department_name DISTINCT
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

  // Distinct department names from active canonical_employees + manager
  // metadata from Bronze odoo_departments (case-insensitive name join).
  // SP5-EXCEPTION: odoo_departments — Bronze read; no canonical_departments
  // table in SP5 scope. Used only for manager_name + member_count metadata
  // that the canonical_employees view does not expose.
  const [empRes, deptRes] = await Promise.all([
    sb
      .from("canonical_employees")
      .select("department_name, department_id")
      .eq("is_active", true)
      .not("department_name", "is", null)
      .order("department_name", { ascending: true }),
    sb
      .from("odoo_departments") // SP5-EXCEPTION: Bronze read for manager_name + parent_name; no canonical_departments table in SP5.
      .select("name, manager_name, member_count, parent_name"),
  ]);

  // department_name lowercase → metadata
  const meta = new Map<
    string,
    { manager_name: string | null; description: string | null }
  >();
  for (const d of (deptRes.data ?? []) as Array<{
    name: string | null;
    manager_name: string | null;
    member_count: number | null;
    parent_name: string | null;
  }>) {
    if (!d.name) continue;
    meta.set(d.name.toLowerCase(), {
      manager_name: d.manager_name,
      description: d.parent_name ? `Reporta a ${d.parent_name}` : null,
    });
  }

  // Deduplicate by department_name (preserve first id seen).
  const seen = new Map<string, number>();
  for (const r of (empRes.data ?? []) as Array<{
    department_name: string | null;
    department_id: number | null;
  }>) {
    if (!r.department_name) continue;
    if (!seen.has(r.department_name)) {
      seen.set(r.department_name, r.department_id ?? 0);
    }
  }

  return Array.from(seen.entries()).map(([name, id], idx) => {
    const m = meta.get(name.toLowerCase());
    return {
      id: id || idx + 1,
      name,
      lead_name: m?.manager_name ?? null,
      lead_email: null, // odoo_departments does not expose manager email
      description: m?.description ?? null,
    };
  });
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
    // Guard: filter empty-string departments (routing fallback failures)
    const dept = row.assignee_department?.trim();
    if (!dept) continue;
    const b = buckets.get(dept) ?? {
      total: 0,
      critical: 0,
      high: 0,
    };
    b.total += 1;
    if (row.severity === "critical") b.critical += 1;
    if (row.severity === "high") b.high += 1;
    buckets.set(dept, b);
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
// Active employees (via canonical_employees view)
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

  // canonical_employees is the source of truth, but
  // manager_canonical_contact_id is null on most rows (MDM contact graph not
  // backfilled). Best-effort: join odoo_employees by case-insensitive name
  // match to surface the manager_name. SP5-EXCEPTION: odoo_employees —
  // Bronze read for hierarchy until canonical_employees populates the FK.
  const [canonRes, bronzeRes] = await Promise.all([
    sb
      .from("canonical_employees")
      .select(
        "contact_id, display_name, primary_email, department_name, job_title, is_active",
      )
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .limit(limit),
    sb
      .from("odoo_employees") // SP5-EXCEPTION: Bronze read for manager_name; canonical_employees.manager_canonical_contact_id not backfilled yet.
      .select("name, manager_name")
      .not("manager_name", "is", null)
      .limit(2000),
  ]);

  const managerByName = new Map<string, string>();
  for (const e of (bronzeRes.data ?? []) as Array<{
    name: string | null;
    manager_name: string | null;
  }>) {
    if (e.name && e.manager_name) {
      managerByName.set(e.name.trim().toLowerCase(), e.manager_name);
    }
  }

  return ((canonRes.data ?? []) as Array<{
    contact_id: number;
    display_name: string | null;
    primary_email: string | null;
    department_name: string | null;
    job_title: string | null;
  }>).map((r) => ({
    id: r.contact_id,
    name: r.display_name,
    work_email: r.primary_email,
    department_name: r.department_name,
    job_title: r.job_title,
    manager_name:
      r.display_name != null
        ? (managerByName.get(r.display_name.trim().toLowerCase()) ?? null)
        : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Required SP5 exports: listTeamMembers, listDepartments, fetchEmployeeWorkload
// ──────────────────────────────────────────────────────────────────────────

export async function listTeamMembers(
  opts: { limit?: number; departmentName?: string } = {}
): Promise<Array<{
  contact_id: number;
  display_name: string | null;
  primary_email: string | null;
  department_name: string | null;
  job_title: string | null;
  odoo_user_id: number | null;
  odoo_employee_id: number | null;
  pending_activities_count: number | null;
  overdue_activities_count: number | null;
  open_insights_count: number | null;
  is_active: boolean | null;
}>> {
  const sb = getServiceClient();
  const { limit = 100, departmentName } = opts;

  let query = sb
    .from("canonical_employees")
    .select(
      "contact_id, display_name, primary_email, department_name, job_title, odoo_user_id, odoo_employee_id, pending_activities_count, overdue_activities_count, open_insights_count, is_active"
    )
    .eq("is_active", true);

  if (departmentName) query = query.eq("department_name", departmentName);

  const { data } = await query
    .order("display_name", { ascending: true })
    .limit(limit);

  return (data ?? []) as Array<{
    contact_id: number;
    display_name: string | null;
    primary_email: string | null;
    department_name: string | null;
    job_title: string | null;
    odoo_user_id: number | null;
    odoo_employee_id: number | null;
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
    open_insights_count: number | null;
    is_active: boolean | null;
  }>;
}

export async function listDepartments(): Promise<Array<{
  name: string;
  department_id: number | null;
  member_count: number;
}>> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_employees")
    .select("department_name, department_id")
    .eq("is_active", true)
    .not("department_name", "is", null)
    .order("department_name", { ascending: true });

  const deptMap = new Map<string, { department_id: number | null; count: number }>();
  for (const r of (data ?? []) as Array<{
    department_name: string | null;
    department_id: number | null;
  }>) {
    if (!r.department_name) continue;
    const existing = deptMap.get(r.department_name);
    if (existing) {
      existing.count += 1;
    } else {
      deptMap.set(r.department_name, { department_id: r.department_id, count: 1 });
    }
  }

  return Array.from(deptMap.entries()).map(([name, v]) => ({
    name,
    department_id: v.department_id,
    member_count: v.count,
  }));
}

/**
 * fetchEmployeeWorkload — open insights + open/overdue activities per employee.
 *
 * agent_insights.assignee_user_id = odoo integer user id
 * We accept either a canonical_contact id OR an odoo_user_id and resolve via
 * canonical_employees.odoo_user_id lookup.
 *
 * If employeeContactId is provided, it is treated as canonical_contacts.id.
 * If odooUserId is provided, it is used directly against agent_insights.assignee_user_id.
 * If neither is provided, returns workload for all active employees.
 */
export async function fetchEmployeeWorkload(opts: {
  employeeContactId?: number;
  odooUserId?: number;
  limit?: number;
} = {}): Promise<Array<{
  contact_id: number;
  display_name: string | null;
  odoo_user_id: number | null;
  department_name: string | null;
  pending_activities_count: number;
  overdue_activities_count: number;
  open_insights_count: number;
  insights_via_assignee: number;
}>> {
  const sb = getServiceClient();
  const { employeeContactId, odooUserId, limit = 50 } = opts;

  // Resolve which employees to fetch
  let empQuery = sb
    .from("canonical_employees")
    .select(
      "contact_id, display_name, odoo_user_id, department_name, pending_activities_count, overdue_activities_count, open_insights_count"
    )
    .eq("is_active", true);

  if (employeeContactId != null) {
    empQuery = empQuery.eq("contact_id", employeeContactId);
  } else if (odooUserId != null) {
    empQuery = empQuery.eq("odoo_user_id", odooUserId);
  }

  const { data: empData } = await empQuery.limit(limit);

  const employees = (empData ?? []) as Array<{
    contact_id: number;
    display_name: string | null;
    odoo_user_id: number | null;
    department_name: string | null;
    pending_activities_count: number | null;
    overdue_activities_count: number | null;
    open_insights_count: number | null;
  }>;

  if (employees.length === 0) return [];

  // Collect all odoo_user_ids to batch-query agent_insights
  const odooUserIds = employees
    .map((e) => e.odoo_user_id)
    .filter((id): id is number => id != null);

  const insightsByOdooUser = new Map<number, number>();
  if (odooUserIds.length > 0) {
    const { data: insightData } = await sb
      .from("agent_insights")
      .select("assignee_user_id")
      .in("state", ["new", "seen"])
      .in("assignee_user_id", odooUserIds);

    for (const row of (insightData ?? []) as Array<{ assignee_user_id: number | null }>) {
      if (!row.assignee_user_id) continue;
      insightsByOdooUser.set(
        row.assignee_user_id,
        (insightsByOdooUser.get(row.assignee_user_id) ?? 0) + 1
      );
    }
  }

  return employees.map((e) => ({
    contact_id: e.contact_id,
    display_name: e.display_name,
    odoo_user_id: e.odoo_user_id,
    department_name: e.department_name,
    pending_activities_count: Number(e.pending_activities_count) || 0,
    overdue_activities_count: Number(e.overdue_activities_count) || 0,
    open_insights_count: Number(e.open_insights_count) || 0,
    insights_via_assignee: e.odoo_user_id
      ? (insightsByOdooUser.get(e.odoo_user_id) ?? 0)
      : 0,
  }));
}
