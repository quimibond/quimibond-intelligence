"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Users, CheckSquare, AlertTriangle, Clock,
  Mail, DollarSign, BarChart3, TrendingUp, TrendingDown,
} from "lucide-react";

interface DeptData {
  department: string;
  lead_or_manager: string | null;
  description: string | null;
  employee_count: number;
  actions_pending: number;
  actions_completed: number;
  actions_overdue: number;
  activities_pending: number;
  activities_overdue: number;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<DeptData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Fetch from multiple sources in parallel
      const [odooDeptsRes, deptsRes, usersRes, actionsRes] = await Promise.all([
        supabase
          .from("odoo_departments")
          .select("odoo_department_id, name, parent_name, manager_name, member_count"),
        supabase
          .from("departments")
          .select("name, lead_name, lead_email, description"),
        supabase
          .from("odoo_users")
          .select("email, department, pending_activities_count, overdue_activities_count"),
        supabase
          .from("action_items")
          .select("assignee_email, state, due_date")
          .not("assignee_email", "is", null),
      ]);

      // Build department metadata lookups
      const odooDeptMeta = new Map<string, { manager_name: string | null; member_count: number | null }>();
      for (const od of odooDeptsRes.data ?? []) {
        odooDeptMeta.set(od.name, { manager_name: od.manager_name, member_count: od.member_count });
      }

      const deptMeta = new Map<string, { lead_name: string | null; description: string | null }>();
      for (const d of deptsRes.data ?? []) {
        deptMeta.set(d.name, { lead_name: d.lead_name, description: d.description });
      }

      // Map email -> department and build base dept map from users (for activity counts)
      const emailToDept = new Map<string, string>();
      const deptMap = new Map<string, DeptData>();

      // Seed departments from odoo_departments if available
      for (const od of odooDeptsRes.data ?? []) {
        const name = od.name;
        const meta = deptMeta.get(name);
        deptMap.set(name, {
          department: name,
          lead_or_manager: meta?.lead_name ?? od.manager_name ?? null,
          description: meta?.description ?? null,
          employee_count: od.member_count ?? 0,
          actions_pending: 0,
          actions_completed: 0,
          actions_overdue: 0,
          activities_pending: 0,
          activities_overdue: 0,
        });
      }

      // Enrich with user activity data (and add any departments not in odoo_departments)
      for (const u of usersRes.data ?? []) {
        const dept = u.department || "Sin departamento";
        emailToDept.set(u.email, dept);
        if (!deptMap.has(dept)) {
          const meta = deptMeta.get(dept);
          const odooMeta = odooDeptMeta.get(dept);
          deptMap.set(dept, {
            department: dept,
            lead_or_manager: meta?.lead_name ?? odooMeta?.manager_name ?? null,
            description: meta?.description ?? null,
            employee_count: 0,
            actions_pending: 0,
            actions_completed: 0,
            actions_overdue: 0,
            activities_pending: 0,
            activities_overdue: 0,
          });
        }
        const d = deptMap.get(dept)!;
        // If we didn't get member_count from odoo_departments, count from users
        if (!odooDeptMeta.has(dept)) {
          d.employee_count++;
        }
        d.activities_pending += u.pending_activities_count ?? 0;
        d.activities_overdue += u.overdue_activities_count ?? 0;
      }

      // Also add departments from the departments table that weren't seen yet
      for (const d of deptsRes.data ?? []) {
        if (!deptMap.has(d.name)) {
          deptMap.set(d.name, {
            department: d.name,
            lead_or_manager: d.lead_name ?? null,
            description: d.description ?? null,
            employee_count: 0,
            actions_pending: 0,
            actions_completed: 0,
            actions_overdue: 0,
            activities_pending: 0,
            activities_overdue: 0,
          });
        }
      }

      const today = new Date().toISOString().split("T")[0];
      for (const a of actionsRes.data ?? []) {
        const dept = emailToDept.get(a.assignee_email) || "Sin departamento";
        if (!deptMap.has(dept)) continue;
        const d = deptMap.get(dept)!;
        if (a.state === "completed") d.actions_completed++;
        else if (a.state === "pending") {
          d.actions_pending++;
          if (a.due_date && a.due_date < today) d.actions_overdue++;
        }
      }

      const sorted = Array.from(deptMap.values()).sort((a, b) => {
        // Sort by employee count, then by name
        return b.employee_count - a.employee_count;
      });

      setDepartments(sorted);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Departamentos" description="Rendimiento por area" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[200px]" />)}
        </div>
      </div>
    );
  }

  const totalEmployees = departments.reduce((s, d) => s + d.employee_count, 0);
  const totalOverdue = departments.reduce((s, d) => s + d.actions_overdue, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departamentos"
        description={`${departments.length} areas — ${totalEmployees} empleados totales`}
      />

      {/* Department Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {departments.map((dept) => {
          const totalActions = dept.actions_pending + dept.actions_completed;
          const completionRate = totalActions > 0 ? Math.round((dept.actions_completed / totalActions) * 100) : 0;
          const hasIssues = dept.actions_overdue > 0 || dept.activities_overdue > 0;

          return (
            <Card key={dept.department} className={cn(hasIssues && "border-red-500/20")}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className={cn("h-4 w-4", hasIssues ? "text-red-500" : "text-muted-foreground")} />
                    <CardTitle className="text-base">{dept.department}</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    <Users className="h-3 w-3 mr-1" />
                    {dept.employee_count}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Lead / Manager & Description */}
                {(dept.lead_or_manager || dept.description) && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {dept.lead_or_manager && (
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3 shrink-0" />
                        <span>Responsable: <span className="font-medium text-foreground">{dept.lead_or_manager}</span></span>
                      </div>
                    )}
                    {dept.description && (
                      <p className="line-clamp-2">{dept.description}</p>
                    )}
                  </div>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Pendientes</p>
                    <p className="text-lg font-semibold">{dept.actions_pending}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vencidas</p>
                    <p className={cn("text-lg font-semibold", dept.actions_overdue > 0 && "text-red-600 dark:text-red-400")}>
                      {dept.actions_overdue}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completadas</p>
                    <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{dept.actions_completed}</p>
                  </div>
                </div>

                {/* Activities */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Actividades Odoo</span>
                  <span>
                    {dept.activities_pending} pendientes
                    {dept.activities_overdue > 0 && (
                      <span className="text-red-500 ml-1">({dept.activities_overdue} vencidas)</span>
                    )}
                  </span>
                </div>

                {/* Completion rate */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Tasa de completado</span>
                    <span className="font-medium">{completionRate}%</span>
                  </div>
                  <Progress
                    value={completionRate}
                    className={cn("h-2", completionRate < 30 ? "[&>div]:bg-red-500" : completionRate < 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")}
                  />
                </div>

                {/* Per-employee average */}
                {dept.employee_count > 0 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                    <span>Promedio por empleado</span>
                    <span>
                      {Math.round((dept.actions_pending + dept.actions_completed) / dept.employee_count)} acciones
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
