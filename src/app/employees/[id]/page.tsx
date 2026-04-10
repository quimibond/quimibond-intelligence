"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, CheckSquare, AlertTriangle, Clock, Mail,
  User, BarChart3, Bot,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface EmployeeData {
  odoo_employee_id: number;
  odoo_user_id: number | null;
  name: string;
  work_email: string | null;
  work_phone: string | null;
  department_name: string | null;
  job_title: string | null;
  job_name: string | null;
  manager_name: string | null;
}

interface Activity {
  id: number;
  activity_type: string | null;
  summary: string | null;
  date_deadline: string | null;
  is_overdue: boolean;
  res_model: string | null;
}

interface Insight {
  id: number;
  title: string;
  severity: string | null;
  category: string | null;
  state: string;
  created_at: string;
}

interface MetricRow {
  period_start: string;
  period_end: string;
  period_type: string;
  execution_score: number | null;
  actions_completed: number;
  actions_overdue: number;
  avg_response_hours: number | null;
  insights_acted: number;
  contacts_managed: number;
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const employeeId = params.id;

  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: emp } = await supabase
        .from("odoo_employees")
        .select("odoo_employee_id, odoo_user_id, name, work_email, work_phone, department_name, job_title, job_name, manager_name")
        .eq("odoo_employee_id", employeeId)
        .single();

      if (!emp) { setLoading(false); return; }
      const e = emp as EmployeeData;
      setEmployee(e);

      // Fetch related data in parallel
      const [activitiesRes, insightsRes, metricsRes] = await Promise.all([
        supabase
          .from("odoo_activities")
          .select("id, activity_type, summary, date_deadline, is_overdue, res_model")
          .eq("assigned_to", e.name)
          .order("date_deadline", { ascending: true })
          .limit(50),
        e.work_email
          ? supabase
              .from("agent_insights")
              .select("id, title, severity, category, state, created_at")
              .eq("assignee_email", e.work_email)
              .order("created_at", { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [] }),
        supabase
          .from("employee_metrics")
          .select("period_start, period_end, period_type, execution_score, actions_completed, actions_overdue, avg_response_hours, insights_acted, contacts_managed")
          .eq("name", e.name)
          .order("period_start", { ascending: false })
          .limit(12),
      ]);

      setActivities((activitiesRes.data ?? []) as Activity[]);
      setInsights((insightsRes.data ?? []) as Insight[]);
      setMetrics((metricsRes.data ?? []) as MetricRow[]);
      setLoading(false);
    }
    load();
  }, [employeeId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div>
        <button onClick={() => router.push("/employees")} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Equipo
        </button>
        <EmptyState icon={User} title="Empleado no encontrado" description="El empleado solicitado no existe." />
      </div>
    );
  }

  const overdueCount = activities.filter(a => a.is_overdue).length;
  const pendingCount = activities.length;
  const activeInsights = insights.filter(i => ["new", "seen"].includes(i.state)).length;
  const latestMetric = metrics.length > 0 ? metrics[0] : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: "Equipo", href: "/employees" },
        { label: employee.name },
      ]} />

      {/* Header */}
      <div>
        <h1 className="text-xl font-black">{employee.name}</h1>
        <p className="text-sm text-muted-foreground">
          {employee.job_title ?? employee.job_name ?? "—"}
          {employee.department_name && <> · {employee.department_name}</>}
          {employee.manager_name && <> · Reporta a {employee.manager_name}</>}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {employee.work_email && (
            <a href={`mailto:${employee.work_email}`} className="text-xs text-primary hover:underline flex items-center gap-1">
              <Mail className="h-3 w-3" /> {employee.work_email}
            </a>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <CheckSquare className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-black tabular-nums">{pendingCount}</p>
            <p className="text-[10px] text-muted-foreground">Actividades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <AlertTriangle className={cn("h-4 w-4 mx-auto mb-1", overdueCount > 0 ? "text-danger" : "text-muted-foreground")} />
            <p className={cn("text-2xl font-black tabular-nums", overdueCount > 0 && "text-danger")}>{overdueCount}</p>
            <p className="text-[10px] text-muted-foreground">Vencidas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Bot className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-black tabular-nums">{activeInsights}</p>
            <p className="text-[10px] text-muted-foreground">Insights</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <BarChart3 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className={cn("text-2xl font-black tabular-nums",
              latestMetric?.execution_score != null && latestMetric.execution_score >= 80 ? "text-success" :
              latestMetric?.execution_score != null && latestMetric.execution_score < 50 ? "text-danger" : ""
            )}>
              {latestMetric?.execution_score != null ? `${latestMetric.execution_score}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Ejecucion</p>
            {latestMetric?.execution_score != null && <Progress value={latestMetric.execution_score} className="mt-1 h-1.5" />}
          </CardContent>
        </Card>
      </div>

      {/* Activities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Actividades Pendientes
            {overdueCount > 0 && <Badge variant="critical">{overdueCount} vencidas</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin actividades pendientes</p>
          ) : (
            <div className="space-y-1.5">
              {activities.map(a => (
                <div key={a.id} className={cn(
                  "flex items-center gap-3 rounded-lg border p-2.5",
                  a.is_overdue && "border-danger/30 bg-danger/5"
                )}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.summary ?? a.activity_type ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{a.activity_type} · {a.res_model?.replace(".", " ")}</p>
                  </div>
                  {a.date_deadline && (
                    <span className={cn("text-xs tabular-nums shrink-0",
                      a.is_overdue ? "text-danger font-semibold" : "text-muted-foreground"
                    )}>
                      {formatDate(a.date_deadline)}
                    </span>
                  )}
                  {a.is_overdue && <Badge variant="critical" className="text-[10px] shrink-0">Vencida</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights assigned */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4" /> Insights Asignados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin insights asignados</p>
          ) : (
            <div className="space-y-1.5">
              {insights.map(ins => (
                <Link key={ins.id} href={`/inbox/insight/${ins.id}`}
                  className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{ins.title}</p>
                    <p className="text-[10px] text-muted-foreground">{ins.category} · {timeAgo(ins.created_at)}</p>
                  </div>
                  <Badge variant={ins.severity === "critical" ? "critical" : ins.severity === "high" ? "warning" : "secondary"} className="text-[10px] shrink-0">
                    {ins.severity ?? "—"}
                  </Badge>
                  <Badge variant={ins.state === "acted_on" ? "success" : ins.state === "dismissed" ? "secondary" : "info"} className="text-[10px] shrink-0">
                    {ins.state}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      {metrics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Historial de Rendimiento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead className="text-right">Ejecucion</TableHead>
                    <TableHead className="text-right">Completadas</TableHead>
                    <TableHead className="text-right">Vencidas</TableHead>
                    <TableHead className="text-right">Resp (hrs)</TableHead>
                    <TableHead className="text-right">Insights</TableHead>
                    <TableHead className="text-right">Contactos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">
                        {formatDate(m.period_start)} — {formatDate(m.period_end)}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.execution_score != null ? (
                          <span className={cn("font-semibold tabular-nums",
                            m.execution_score >= 80 ? "text-success" : m.execution_score < 50 ? "text-danger" : ""
                          )}>{m.execution_score}%</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.actions_completed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn(m.actions_overdue > 0 && "text-danger")}>{m.actions_overdue}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.avg_response_hours?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.insights_acted}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.contacts_managed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
