"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Users, AlertTriangle, Clock } from "lucide-react";

interface DeptData {
  department: string;
  lead_or_manager: string | null;
  description: string | null;
  employee_count: number;
  activities_pending: number;
  activities_overdue: number;
  insights_count: number;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<DeptData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [odooDeptsRes, deptsRes, usersRes, insightsRes] = await Promise.all([
        supabase.from("odoo_departments").select("name, manager_name, member_count"),
        supabase.from("departments").select("name, lead_name, description"),
        supabase.from("odoo_users").select("email, department, pending_activities_count, overdue_activities_count"),
        supabase.from("agent_insights").select("assignee_department")
          .in("state", ["new", "seen"]).not("assignee_department", "is", null),
      ]);

      const odooDeptMeta = new Map<string, { manager_name: string | null; member_count: number | null }>();
      for (const od of odooDeptsRes.data ?? []) {
        odooDeptMeta.set(od.name, { manager_name: od.manager_name, member_count: od.member_count });
      }

      const deptMeta = new Map<string, { lead_name: string | null; description: string | null }>();
      for (const d of deptsRes.data ?? []) {
        deptMeta.set(d.name, { lead_name: d.lead_name, description: d.description });
      }

      // Insight counts by department
      const insightsByDept = new Map<string, number>();
      for (const i of insightsRes.data ?? []) {
        if (!i.assignee_department) continue;
        insightsByDept.set(i.assignee_department, (insightsByDept.get(i.assignee_department) ?? 0) + 1);
      }

      const deptMap = new Map<string, DeptData>();

      // Seed from odoo_departments
      for (const od of odooDeptsRes.data ?? []) {
        const meta = deptMeta.get(od.name);
        deptMap.set(od.name, {
          department: od.name,
          lead_or_manager: meta?.lead_name ?? od.manager_name ?? null,
          description: meta?.description ?? null,
          employee_count: od.member_count ?? 0,
          activities_pending: 0,
          activities_overdue: 0,
          insights_count: insightsByDept.get(od.name) ?? 0,
        });
      }

      // Enrich with user activity data
      for (const u of usersRes.data ?? []) {
        const dept = u.department || "Sin departamento";
        if (!deptMap.has(dept)) {
          const meta = deptMeta.get(dept);
          const odooMeta = odooDeptMeta.get(dept);
          deptMap.set(dept, {
            department: dept,
            lead_or_manager: meta?.lead_name ?? odooMeta?.manager_name ?? null,
            description: meta?.description ?? null,
            employee_count: 0,
            activities_pending: 0,
            activities_overdue: 0,
            insights_count: insightsByDept.get(dept) ?? 0,
          });
        }
        const d = deptMap.get(dept)!;
        if (!odooDeptMeta.has(dept)) d.employee_count++;
        d.activities_pending += u.pending_activities_count ?? 0;
        d.activities_overdue += u.overdue_activities_count ?? 0;
      }

      // Add departments from departments table not yet seen
      for (const d of deptsRes.data ?? []) {
        if (!deptMap.has(d.name)) {
          deptMap.set(d.name, {
            department: d.name,
            lead_or_manager: d.lead_name ?? null,
            description: d.description ?? null,
            employee_count: 0,
            activities_pending: 0,
            activities_overdue: 0,
            insights_count: insightsByDept.get(d.name) ?? 0,
          });
        }
      }

      setDepartments(
        Array.from(deptMap.values()).sort((a, b) => b.employee_count - a.employee_count)
      );
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Areas" description="Rendimiento por departamento" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[140px]" />)}
        </div>
      </div>
    );
  }

  const totalEmployees = departments.reduce((s, d) => s + d.employee_count, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Areas"
        description={`${departments.length} departamentos — ${totalEmployees} empleados`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((dept) => {
          const hasIssues = dept.activities_overdue > 0;

          return (
            <Card key={dept.department} className={cn(hasIssues && "border-danger/20")}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className={cn("h-4 w-4 shrink-0", hasIssues ? "text-danger" : "text-muted-foreground")} />
                    <CardTitle className="text-sm sm:text-base truncate">{dept.department}</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    <Users className="h-3 w-3 mr-1" />
                    {dept.employee_count}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Lead */}
                {dept.lead_or_manager && (
                  <p className="text-xs text-muted-foreground">
                    Responsable: <span className="font-medium text-foreground">{dept.lead_or_manager}</span>
                  </p>
                )}
                {dept.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{dept.description}</p>
                )}

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold tabular-nums">{dept.activities_pending}</p>
                    <p className="text-[10px] text-muted-foreground">Pendientes</p>
                  </div>
                  <div>
                    <p className={cn("text-lg font-bold tabular-nums", dept.activities_overdue > 0 && "text-danger-foreground")}>
                      {dept.activities_overdue}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Vencidas</p>
                  </div>
                  <div>
                    <p className={cn("text-lg font-bold tabular-nums", dept.insights_count > 0 && "text-warning")}>
                      {dept.insights_count}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Insights</p>
                  </div>
                </div>

                {/* Per-employee average */}
                {dept.employee_count > 0 && (
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
                    <span>Prom. por empleado</span>
                    <span className="tabular-nums">{Math.round(dept.activities_pending / dept.employee_count)} actividades</span>
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
