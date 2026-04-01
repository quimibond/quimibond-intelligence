"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { FilterBar } from "@/components/shared/filter-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { Select } from "@/components/ui/select-native";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Users, CheckSquare, AlertTriangle, Clock, User, BarChart3,
} from "lucide-react";

interface Employee {
  id: number;
  name: string;
  email: string | null;
  department: string | null;
  job_title: string | null;
  manager: string | null;
  pending_activities: number;
  overdue_activities: number;
  insights_count: number;
  execution_score: number | null;
  actions_overdue: number;
  contacts_managed: number;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeMetrics, setEmployeeMetrics] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  useEffect(() => {
    async function load() {
      const [employeesRes, usersRes, activitiesRes, insightsRes, metricsRes] = await Promise.all([
        supabase
          .from("odoo_employees")
          .select("odoo_employee_id, odoo_user_id, name, work_email, department_name, job_title, job_name, manager_name, is_active")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("odoo_users")
          .select("odoo_user_id, name, email, department, job_title, pending_activities_count, overdue_activities_count")
          .order("name"),
        supabase
          .from("odoo_activities")
          .select("assigned_to, is_overdue")
          .not("assigned_to", "is", null),
        supabase
          .from("agent_insights")
          .select("assignee_email")
          .in("state", ["new", "seen"])
          .not("assignee_email", "is", null),
        supabase
          .from("employee_metrics")
          .select("name, email, execution_score, actions_overdue, contacts_managed")
          .eq("period_type", "weekly")
          .order("overall_score", { ascending: false }),
      ]);

      // User lookup
      const userById = new Map<number, { pending: number; overdue: number; email: string | null }>();
      for (const u of usersRes.data ?? []) {
        userById.set(u.odoo_user_id, {
          pending: u.pending_activities_count ?? 0,
          overdue: u.overdue_activities_count ?? 0,
          email: u.email,
        });
      }

      // Activity counts by assigned_to (name)
      const activityByName = new Map<string, { pending: number; overdue: number }>();
      for (const a of activitiesRes.data ?? []) {
        if (!a.assigned_to) continue;
        if (!activityByName.has(a.assigned_to)) activityByName.set(a.assigned_to, { pending: 0, overdue: 0 });
        const entry = activityByName.get(a.assigned_to)!;
        entry.pending++;
        if (a.is_overdue) entry.overdue++;
      }

      // Insight counts by email
      const insightsByEmail = new Map<string, number>();
      for (const i of insightsRes.data ?? []) {
        if (!i.assignee_email) continue;
        insightsByEmail.set(i.assignee_email, (insightsByEmail.get(i.assignee_email) ?? 0) + 1);
      }

      // Employee metrics lookup by name (fuzzy -- first name match)
      const metricsByName = new Map<string, { execution_score: number; actions_overdue: number; contacts_managed: number }>();
      for (const m of metricsRes.data ?? []) {
        if (m.name) metricsByName.set(m.name.toLowerCase(), m);
      }

      function findMetrics(name: string) {
        const lower = name.toLowerCase();
        if (metricsByName.has(lower)) return metricsByName.get(lower)!;
        const firstName = lower.split(" ")[0];
        for (const [key, val] of metricsByName) {
          if (key.startsWith(firstName)) return val;
        }
        return null;
      }

      const useEmployees = (employeesRes.data ?? []).length > 0;

      let result: Employee[];

      if (useEmployees) {
        result = (employeesRes.data ?? []).map((e) => {
          const userInfo = e.odoo_user_id ? userById.get(e.odoo_user_id) : undefined;
          const email = e.work_email ?? userInfo?.email ?? null;
          const activityInfo = activityByName.get(e.name);
          const metrics = findMetrics(e.name);
          return {
            id: e.odoo_employee_id,
            name: e.name,
            email,
            department: e.department_name ?? null,
            job_title: e.job_title ?? e.job_name ?? null,
            manager: e.manager_name ?? null,
            pending_activities: activityInfo?.pending ?? userInfo?.pending ?? 0,
            overdue_activities: activityInfo?.overdue ?? userInfo?.overdue ?? 0,
            insights_count: email ? (insightsByEmail.get(email) ?? 0) : 0,
            execution_score: metrics?.execution_score ?? null,
            actions_overdue: metrics?.actions_overdue ?? 0,
            contacts_managed: metrics?.contacts_managed ?? 0,
          };
        });
      } else {
        result = (usersRes.data ?? []).map((u) => {
          const activityInfo = activityByName.get(u.name);
          const metrics = findMetrics(u.name);
          return {
            id: u.odoo_user_id,
            name: u.name,
            email: u.email ?? null,
            department: u.department ?? null,
            job_title: u.job_title ?? null,
            manager: null,
            pending_activities: activityInfo?.pending ?? u.pending_activities_count ?? 0,
            overdue_activities: activityInfo?.overdue ?? u.overdue_activities_count ?? 0,
            insights_count: u.email ? (insightsByEmail.get(u.email) ?? 0) : 0,
            execution_score: metrics?.execution_score ?? null,
            actions_overdue: metrics?.actions_overdue ?? 0,
            contacts_managed: metrics?.contacts_managed ?? 0,
          };
        });
      }

      setEmployees(result);

      // Fetch detailed employee metrics for table
      const empMetricsRes = await supabase
        .from("employee_metrics")
        .select("*")
        .order("period_end", { ascending: false })
        .limit(20);
      if (empMetricsRes.data && empMetricsRes.data.length > 0) {
        setEmployeeMetrics(empMetricsRes.data);
      }

      setLoading(false);
    }
    load();
  }, []);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))] as string[];

  // Apply search + department filter
  const filtered = employees.filter((e) => {
    if (departmentFilter === "issues" && e.overdue_activities <= 0) return false;
    if (departmentFilter !== "all" && departmentFilter !== "issues" && e.department !== departmentFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesName = e.name.toLowerCase().includes(q);
      const matchesEmail = e.email?.toLowerCase().includes(q);
      const matchesDept = e.department?.toLowerCase().includes(q);
      const matchesJob = e.job_title?.toLowerCase().includes(q);
      if (!matchesName && !matchesEmail && !matchesDept && !matchesJob) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (b.overdue_activities !== a.overdue_activities) return b.overdue_activities - a.overdue_activities;
    if ((a.execution_score ?? 100) !== (b.execution_score ?? 100)) return (a.execution_score ?? 100) - (b.execution_score ?? 100);
    return b.pending_activities - a.pending_activities;
  });

  const totalOverdue = employees.reduce((s, e) => s + e.overdue_activities, 0);
  const totalPending = employees.reduce((s, e) => s + e.pending_activities, 0);
  const totalInsights = employees.reduce((s, e) => s + e.insights_count, 0);
  const withIssues = employees.filter(e => e.overdue_activities > 0).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Empleados" description="Carga de trabajo y actividades" />
        <LoadingGrid stats={4} rows={6} statHeight="h-[80px]" rowHeight="h-[72px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Empleados"
        description={`${employees.length} empleados — ${departments.length} departamentos`}
      />

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <MiniStatCard icon={Users} label="Empleados" value={employees.length} />
        <MiniStatCard icon={AlertTriangle} label="Vencidas" value={totalOverdue} valueClassName={totalOverdue > 0 ? "text-danger-foreground" : undefined} />
        <MiniStatCard icon={Clock} label="Pendientes" value={totalPending} />
        <MiniStatCard icon={CheckSquare} label="Insights" value={totalInsights} />
      </div>

      {/* Search + Filters */}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar empleado...">
        <Select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="w-40 shrink-0"
          aria-label="Filtrar por departamento"
        >
          <option value="all">Todos ({employees.length})</option>
          {withIssues > 0 && (
            <option value="issues">Con retrasos ({withIssues})</option>
          )}
          {departments.map(d => (
            <option key={d} value={d}>
              {d} ({employees.filter(e => e.department === d).length})
            </option>
          ))}
        </Select>
      </FilterBar>

      {/* Empty state */}
      {sorted.length === 0 && (
        <EmptyState
          icon={Users}
          title="Sin empleados"
          description={
            search
              ? "No se encontraron empleados con esa busqueda."
              : departmentFilter === "issues"
                ? "Sin empleados con retrasos."
                : "Sin empleados en este departamento."
          }
        />
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MOBILE: Card layout                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {sorted.length > 0 && (
        <div className="space-y-2 md:hidden">
          {sorted.map((emp) => {
            const hasIssues = emp.overdue_activities > 0;

            return (
              <Card key={emp.id} className={cn(hasIssues && "border-danger/20")}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold shrink-0",
                      hasIssues ? "bg-danger/15 text-danger-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      {emp.name?.charAt(0) ?? <User className="h-4 w-4" />}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{emp.name}</p>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {emp.department && <span>{emp.department}</span>}
                        {emp.job_title && <><span>·</span><span className="truncate">{emp.job_title}</span></>}
                      </div>
                    </div>

                    {/* Mobile badges */}
                    <div className="flex gap-1 shrink-0">
                      {emp.overdue_activities > 0 && (
                        <Badge variant="critical" className="text-[10px]">{emp.overdue_activities} venc.</Badge>
                      )}
                      {emp.pending_activities > 0 && !emp.overdue_activities && (
                        <Badge variant="outline" className="text-[10px]">{emp.pending_activities}</Badge>
                      )}
                      {emp.insights_count > 0 && (
                        <Badge variant="warning" className="text-[10px]">{emp.insights_count}</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Table layout                                        */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {sorted.length > 0 && (
        <div className="hidden md:block">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead className="text-right">Pendientes</TableHead>
                  <TableHead className="text-right">Vencidas</TableHead>
                  <TableHead className="text-right">Ejecucion</TableHead>
                  <TableHead className="text-right">Acc. vencidas</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Insights</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((emp) => {
                  const hasIssues = emp.overdue_activities > 0;
                  return (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                            hasIssues ? "bg-danger/15 text-danger-foreground" : "bg-muted text-muted-foreground"
                          )}>
                            {emp.name?.charAt(0) ?? <User className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{emp.name}</p>
                            {emp.job_title && <p className="text-[10px] text-muted-foreground truncate">{emp.job_title}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {emp.department ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {emp.pending_activities}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right tabular-nums text-sm",
                        emp.overdue_activities > 0 && "text-danger-foreground font-semibold"
                      )}>
                        {emp.overdue_activities}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {emp.execution_score != null ? (
                          <span className={cn(
                            "font-semibold",
                            emp.execution_score >= 50 ? "text-success" : emp.execution_score >= 20 ? "text-warning" : "text-danger-foreground"
                          )}>
                            {emp.execution_score}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right tabular-nums text-sm",
                        emp.actions_overdue > 0 && "text-danger-foreground font-semibold"
                      )}>
                        {emp.actions_overdue > 0 ? emp.actions_overdue : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {emp.contacts_managed > 0 ? emp.contacts_managed : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.insights_count > 0 ? (
                          <Badge variant="warning" className="text-[10px]">{emp.insights_count}</Badge>
                        ) : <span className="text-muted-foreground tabular-nums text-sm">0</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Employee Metrics Table */}
      {employeeMetrics.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Metricas de Rendimiento</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead className="text-right">Completadas</TableHead>
                  <TableHead className="text-right">Vencidas</TableHead>
                  <TableHead className="text-right">Resp. (hrs)</TableHead>
                  <TableHead className="text-right">Insights</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeMetrics.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-xs">
                      {(m.name as string) ?? (m.email as string) ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {(m.period_type as string) ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {(m.actions_completed as number) ?? 0}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums text-xs",
                      ((m.actions_overdue as number) ?? 0) > 0 && "text-danger-foreground font-semibold"
                    )}>
                      {(m.actions_overdue as number) ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {(m.avg_response_hours as number) != null
                        ? (m.avg_response_hours as number).toFixed(1)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {(m.insights_acted as number) ?? 0}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(m.period_start as string)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(m.period_end as string)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
