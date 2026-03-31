"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Mail, CheckSquare, AlertTriangle, Clock, BarChart3,
  ArrowUp, ArrowDown, Minus, User,
} from "lucide-react";

interface Employee {
  odoo_user_id: number;
  name: string;
  email: string | null;
  department: string | null;
  job_title: string | null;
  pending_activities_count: number;
  overdue_activities_count: number;
  // Computed from action_items
  actions_pending: number;
  actions_completed: number;
  actions_overdue: number;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    async function load() {
      // Fetch users + their action stats
      const [usersRes, actionsRes] = await Promise.all([
        supabase
          .from("odoo_users")
          .select("odoo_user_id, name, email, department, job_title, pending_activities_count, overdue_activities_count")
          .order("name"),
        supabase
          .from("action_items")
          .select("assignee_email, state")
          .not("assignee_email", "is", null),
      ]);

      // Aggregate actions by assignee
      const actionMap = new Map<string, { pending: number; completed: number; overdue: number }>();
      const today = new Date().toISOString().split("T")[0];

      for (const a of actionsRes.data ?? []) {
        const key = a.assignee_email;
        if (!actionMap.has(key)) actionMap.set(key, { pending: 0, completed: 0, overdue: 0 });
        const entry = actionMap.get(key)!;
        if (a.state === "completed") entry.completed++;
        else if (a.state === "pending") entry.pending++;
      }

      // Also get overdue count
      const overdueRes = await supabase
        .from("action_items")
        .select("assignee_email")
        .eq("state", "pending")
        .lt("due_date", today)
        .not("assignee_email", "is", null);

      for (const a of overdueRes.data ?? []) {
        const entry = actionMap.get(a.assignee_email);
        if (entry) entry.overdue++;
      }

      const enriched: Employee[] = (usersRes.data ?? []).map((u) => ({
        ...u,
        actions_pending: actionMap.get(u.email ?? "")?.pending ?? 0,
        actions_completed: actionMap.get(u.email ?? "")?.completed ?? 0,
        actions_overdue: actionMap.get(u.email ?? "")?.overdue ?? 0,
      }));

      setEmployees(enriched);
      setLoading(false);
    }
    load();
  }, []);

  // Get unique departments
  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))] as string[];

  const filtered = filter === "all"
    ? employees
    : filter === "issues"
      ? employees.filter(e => e.actions_overdue > 0 || e.overdue_activities_count > 0)
      : employees.filter(e => e.department === filter);

  // Sort: most overdue first, then by total load
  const sorted = [...filtered].sort((a, b) => {
    const aIssues = a.actions_overdue + a.overdue_activities_count;
    const bIssues = b.actions_overdue + b.overdue_activities_count;
    if (bIssues !== aIssues) return bIssues - aIssues;
    return (b.actions_pending + b.pending_activities_count) - (a.actions_pending + a.pending_activities_count);
  });

  // Stats
  const totalOverdue = employees.reduce((s, e) => s + e.actions_overdue, 0);
  const totalPending = employees.reduce((s, e) => s + e.actions_pending, 0);
  const totalCompleted = employees.reduce((s, e) => s + e.actions_completed, 0);
  const withIssues = employees.filter(e => e.actions_overdue > 0 || e.overdue_activities_count > 0).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Empleados" description="Visibilidad de rendimiento por persona" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[80px]" />)}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Empleados"
        description={`${employees.length} empleados internos — rendimiento y carga de trabajo`}
      />

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>Empleados</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{employees.length}</p>
            <p className="text-xs text-muted-foreground">{departments.length} departamentos</p>
          </CardContent>
        </Card>
        <Card className={totalOverdue > 0 ? "border-red-500/30 bg-red-500/5" : ""}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span>Acciones Vencidas</span>
            </div>
            <p className={cn("mt-1 text-2xl font-bold", totalOverdue > 0 && "text-red-600 dark:text-red-400")}>{totalOverdue}</p>
            <p className="text-xs text-muted-foreground">{withIssues} empleados con retrasos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span>Pendientes</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{totalPending}</p>
            <p className="text-xs text-muted-foreground">acciones en espera</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
              <span>Completadas</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totalCompleted}</p>
            <p className="text-xs text-muted-foreground">acciones cerradas</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant={filter === "all" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setFilter("all")}
        >
          Todos ({employees.length})
        </Badge>
        <Badge
          variant={filter === "issues" ? "default" : "outline"}
          className={cn("cursor-pointer", filter === "issues" && "bg-red-500")}
          onClick={() => setFilter("issues")}
        >
          Con retrasos ({withIssues})
        </Badge>
        {departments.map(d => (
          <Badge
            key={d}
            variant={filter === d ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilter(d)}
          >
            {d} ({employees.filter(e => e.department === d).length})
          </Badge>
        ))}
      </div>

      {/* Employee List */}
      <div className="space-y-2">
        {sorted.map((emp) => {
          const totalActions = emp.actions_pending + emp.actions_completed;
          const completionRate = totalActions > 0 ? Math.round((emp.actions_completed / totalActions) * 100) : 0;
          const hasIssues = emp.actions_overdue > 0 || emp.overdue_activities_count > 0;

          return (
            <Card key={emp.odoo_user_id} className={cn(hasIssues && "border-red-500/20")}>
              <CardContent className="py-3">
                <div className="flex items-center gap-4">
                  {/* Avatar / name */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold shrink-0",
                      hasIssues ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"
                    )}>
                      {emp.name?.charAt(0) ?? <User className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{emp.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {emp.department && <span>{emp.department}</span>}
                        {emp.job_title && <><span>·</span><span>{emp.job_title}</span></>}
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="hidden md:flex items-center gap-6 text-center shrink-0">
                    <div>
                      <p className="text-xs text-muted-foreground">Actividades</p>
                      <p className="font-semibold text-sm">
                        {emp.pending_activities_count}
                        {emp.overdue_activities_count > 0 && (
                          <span className="text-red-500 ml-1">({emp.overdue_activities_count})</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pendientes</p>
                      <p className="font-semibold text-sm">{emp.actions_pending}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Vencidas</p>
                      <p className={cn("font-semibold text-sm", emp.actions_overdue > 0 && "text-red-600")}>
                        {emp.actions_overdue}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Completadas</p>
                      <p className="font-semibold text-sm text-emerald-600">{emp.actions_completed}</p>
                    </div>
                  </div>

                  {/* Completion rate */}
                  <div className="hidden lg:flex items-center gap-2 w-24 shrink-0">
                    <Progress value={completionRate} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground w-8 text-right">{completionRate}%</span>
                  </div>

                  {/* Status badges (mobile) */}
                  <div className="flex md:hidden gap-1 shrink-0">
                    {emp.actions_overdue > 0 && (
                      <Badge variant="critical" className="text-[10px]">{emp.actions_overdue}</Badge>
                    )}
                    {emp.actions_pending > 0 && (
                      <Badge variant="warning" className="text-[10px]">{emp.actions_pending}</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
