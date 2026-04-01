"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Users, Mail, CheckSquare, AlertTriangle, Clock, User,
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
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    async function load() {
      const [employeesRes, usersRes, activitiesRes, insightsRes] = await Promise.all([
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

      const useEmployees = (employeesRes.data ?? []).length > 0;

      let result: Employee[];

      if (useEmployees) {
        result = (employeesRes.data ?? []).map((e) => {
          const userInfo = e.odoo_user_id ? userById.get(e.odoo_user_id) : undefined;
          const email = e.work_email ?? userInfo?.email ?? null;
          const activityInfo = activityByName.get(e.name);
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
          };
        });
      } else {
        result = (usersRes.data ?? []).map((u) => {
          const activityInfo = activityByName.get(u.name);
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
          };
        });
      }

      setEmployees(result);
      setLoading(false);
    }
    load();
  }, []);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))] as string[];

  const filtered = filter === "all"
    ? employees
    : filter === "issues"
      ? employees.filter(e => e.overdue_activities > 0)
      : employees.filter(e => e.department === filter);

  const sorted = [...filtered].sort((a, b) => {
    if (b.overdue_activities !== a.overdue_activities) return b.overdue_activities - a.overdue_activities;
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            filter === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          Todos ({employees.length})
        </button>
        {withIssues > 0 && (
          <button
            onClick={() => setFilter(filter === "issues" ? "all" : "issues")}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === "issues" ? "bg-danger text-white" : "bg-danger/10 text-danger-foreground hover:bg-danger/20"
            )}
          >
            Con retrasos ({withIssues})
          </button>
        )}
        {departments.map(d => (
          <button
            key={d}
            onClick={() => setFilter(filter === d ? "all" : d)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === d ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {d} ({employees.filter(e => e.department === d).length})
          </button>
        ))}
      </div>

      {/* Employee List */}
      <div className="space-y-2">
        {sorted.map((emp) => {
          const hasIssues = emp.overdue_activities > 0;

          return (
            <Card key={emp.id} className={cn(hasIssues && "border-danger/20")}>
              <CardContent className="py-3">
                <div className="flex items-center gap-3 sm:gap-4">
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

                  {/* Metrics — desktop */}
                  <div className="hidden sm:flex items-center gap-4 text-center shrink-0">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Pendientes</p>
                      <p className="font-semibold text-sm tabular-nums">{emp.pending_activities}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Vencidas</p>
                      <p className={cn("font-semibold text-sm tabular-nums", emp.overdue_activities > 0 && "text-danger-foreground")}>
                        {emp.overdue_activities}
                      </p>
                    </div>
                    {emp.insights_count > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">Insights</p>
                        <p className="font-semibold text-sm tabular-nums text-warning">{emp.insights_count}</p>
                      </div>
                    )}
                  </div>

                  {/* Mobile badges */}
                  <div className="flex sm:hidden gap-1 shrink-0">
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

        {sorted.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {filter === "issues" ? "Sin empleados con retrasos" : "Sin empleados en este departamento"}
          </div>
        )}
      </div>
    </div>
  );
}
