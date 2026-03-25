"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo, scoreToPercent } from "@/lib/utils";
import type { DirectorDashboard, DashboardKPI } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { RiskBadge } from "@/components/shared/risk-badge";
import { PredictionStats } from "@/components/shared/prediction-stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { Bell, CheckSquare, CreditCard, PackageX, Users, Mail, AlertTriangle, ClipboardList, FileText, UserCheck, UserCog } from "lucide-react";

async function fetchDashboardFallback(): Promise<DirectorDashboard> {
  // Fallback: query tables directly when RPC doesn't exist
  const today = new Date().toISOString().split("T")[0];

  const [
    alertsNewRes,
    alertsCritRes,
    actionsPendingRes,
    actionsOverdueRes,
    actionsCompletedRes,
    contactsRiskRes,
    totalContactsRes,
    totalEmailsRes,
    alertsResolvedRes,
    criticalAlertsRes,
    overdueActionsRes,
    contactsAtRiskRes,
  ] = await Promise.all([
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new").in("severity", ["critical", "high"]),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending").lt("due_date", today),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("risk_level", "high"),
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("emails").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
    supabase.from("alerts").select("id, title, severity, contact_name, description, created_at, alert_type").eq("state", "new").in("severity", ["critical", "high"]).order("created_at", { ascending: false }).limit(8),
    supabase.from("action_items").select("id, description, contact_name, contact_company, assignee_email, assignee_name, due_date, priority, action_type").eq("state", "pending").lt("due_date", today).order("due_date", { ascending: true }).limit(10),
    supabase.from("contacts").select("id, name, company, risk_level, sentiment_score, relationship_score").eq("risk_level", "high").order("relationship_score", { ascending: true }).limit(8),
  ]);

  const kpi: DashboardKPI = {
    open_alerts: alertsNewRes.count ?? 0,
    critical_alerts: alertsCritRes.count ?? 0,
    pending_actions: actionsPendingRes.count ?? 0,
    overdue_actions: actionsOverdueRes.count ?? 0,
    at_risk_contacts: contactsRiskRes.count ?? 0,
    total_contacts: totalContactsRes.count ?? 0,
    total_emails: totalEmailsRes.count ?? 0,
    completed_actions: actionsCompletedRes.count ?? 0,
    resolved_alerts: alertsResolvedRes.count ?? 0,
  };

  const overdue = (overdueActionsRes.data ?? []).map((a) => ({
    ...a,
    days_overdue: a.due_date
      ? Math.max(0, Math.floor((Date.now() - new Date(a.due_date).getTime()) / 86400000))
      : 0,
  }));

  const contactsRisk = (contactsAtRiskRes.data ?? []).map((c) => ({
    ...c,
    open_alerts: 0,
    pending_actions: 0,
  }));

  // Fetch latest briefing (try daily_summaries first, then briefings)
  let latestBriefing = null;
  const { data: dailySummary } = await supabase
    .from("daily_summaries")
    .select("*")
    .order("summary_date", { ascending: false })
    .limit(1)
    .single();
  if (dailySummary) {
    latestBriefing = dailySummary;
  }

  // Fetch accountability (actions grouped by assignee)
  const { data: accountabilityRaw } = await supabase
    .from("action_items")
    .select("assignee_name, assignee_email, state")
    .not("assignee_email", "is", null);

  const accountabilityMap = new Map<string, { name: string; email: string | null; pending: number; overdue: number; completed: number }>();
  for (const item of accountabilityRaw ?? []) {
    const key = item.assignee_email ?? "unknown";
    if (!accountabilityMap.has(key)) {
      accountabilityMap.set(key, {
        name: item.assignee_name ?? key,
        email: item.assignee_email,
        pending: 0,
        overdue: 0,
        completed: 0,
      });
    }
    const entry = accountabilityMap.get(key)!;
    if (item.state === "pending") entry.pending++;
    else if (item.state === "completed") entry.completed++;
  }

  return {
    kpi,
    critical_alerts: criticalAlertsRes.data ?? [],
    overdue_actions: overdue,
    accountability: Array.from(accountabilityMap.values())
      .sort((a, b) => b.pending - a.pending)
      .slice(0, 10),
    contacts_at_risk: contactsRisk,
    latest_briefing: latestBriefing,
    pending_actions: [],
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DirectorDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [stockoutCount, setStockoutCount] = useState(0);
  const [lowComplianceCount, setLowComplianceCount] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      // Try RPC first, fallback to direct queries
      const { data: result, error } = await supabase.rpc("get_director_dashboard");
      if (!error && result) {
        setData(result as unknown as DirectorDashboard);
      } else {
        // RPC failed (probably doesn't exist) — use fallback
        try {
          const fallback = await fetchDashboardFallback();
          setData(fallback);
        } catch {
          // Even fallback failed
        }
      }
      // Extra KPIs for product/payment intelligence
      const [stockoutRes, complianceRes] = await Promise.all([
        supabase
          .from("alerts")
          .select("id", { count: "exact", head: true })
          .eq("state", "new")
          .eq("alert_type", "stockout_risk"),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .lt("payment_compliance_score", 50)
          .not("payment_compliance_score", "is", null),
      ]);
      setStockoutCount(stockoutRes.count ?? 0);
      setLowComplianceCount(complianceRes.count ?? 0);

      // Fetch team dashboard (non-blocking)
      Promise.resolve(supabase.rpc("get_team_dashboard")).then(({ data: teamData }) => {
        if (Array.isArray(teamData)) {
          setTeamMembers(teamData);
        }
      }).catch(() => { /* RPC may not exist */ });

      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Vista ejecutiva de inteligencia comercial" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] w-full" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Vista ejecutiva de inteligencia comercial" />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No se pudieron cargar los datos del dashboard. Verifica la conexion a Supabase.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { kpi, critical_alerts, overdue_actions, contacts_at_risk, latest_briefing, accountability } = data;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Vista ejecutiva de inteligencia comercial" />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Alertas Criticas" value={kpi.critical_alerts} icon={Bell} description={`${kpi.open_alerts} abiertas`} />
        <StatCard title="Acciones Pendientes" value={kpi.pending_actions} icon={CheckSquare} description={`${kpi.overdue_actions} vencidas`} />
        <StatCard title="Contactos en Riesgo" value={kpi.at_risk_contacts} icon={Users} description={`de ${kpi.total_contacts}`} />
        <StatCard title="Emails Procesados" value={kpi.total_emails} icon={Mail} />
        <StatCard title="Riesgo Desabasto" value={stockoutCount} icon={PackageX} description="alertas activas" />
        <StatCard title="Compliance Bajo" value={lowComplianceCount} icon={CreditCard} description="contactos <50%" />
      </div>

      {/* Alerts & Overdue Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <CardTitle>Alertas Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {critical_alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay alertas criticas.</p>
            ) : (
              <div className="space-y-3">
                {critical_alerts.map((alert) => (
                  <Link key={alert.id} href={`/alerts/${alert.id}`} className="flex items-start justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={alert.severity} />
                        <span className="text-sm font-medium leading-tight">{alert.title}</span>
                      </div>
                      {alert.contact_name && (
                        <p className="text-xs text-muted-foreground">{alert.contact_name}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(alert.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <ClipboardList className="h-4 w-4 text-amber-500" />
            <CardTitle>Acciones Vencidas</CardTitle>
          </CardHeader>
          <CardContent>
            {overdue_actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay acciones vencidas.</p>
            ) : (
              <div className="space-y-3">
                {overdue_actions.map((action) => (
                  <div key={action.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-tight">{action.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {action.assignee_name ?? action.assignee_email ?? "Sin asignar"}
                      </p>
                    </div>
                    <Badge variant="critical" className="shrink-0">
                      {action.days_overdue}d vencida
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latest Briefing & Accountability */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Latest Briefing */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <FileText className="h-4 w-4 text-blue-500" />
            <CardTitle>Ultimo Briefing</CardTitle>
          </CardHeader>
          <CardContent>
            {latest_briefing ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {latest_briefing.summary_date} · {latest_briefing.total_emails ?? 0} emails procesados
                </p>
                <p className="text-sm line-clamp-6">
                  {latest_briefing.summary_text
                    ? latest_briefing.summary_text.slice(0, 400) + (latest_briefing.summary_text.length > 400 ? "..." : "")
                    : "Sin resumen disponible."}
                </p>
                <Link
                  href="/briefings"
                  className="inline-block text-xs text-primary hover:underline mt-2"
                >
                  Ver todos los briefings
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay briefings generados aun.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Accountability */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <UserCheck className="h-4 w-4 text-purple-500" />
            <CardTitle>Responsabilidad</CardTitle>
          </CardHeader>
          <CardContent>
            {accountability && accountability.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Responsable</TableHead>
                    <TableHead className="text-right">Pendientes</TableHead>
                    <TableHead className="text-right">Completadas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountability.map((a) => (
                    <TableRow key={a.email}>
                      <TableCell className="text-sm">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs text-muted-foreground">{a.email}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={a.pending > 3 ? "critical" : a.pending > 0 ? "warning" : "secondary"}>
                          {a.pending}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success">{a.completed}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay datos de responsabilidad disponibles.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contacts at Risk */}
      <Card>
        <CardHeader>
          <CardTitle>Contactos en Riesgo</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts_at_risk.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay contactos en riesgo.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead className="w-[140px]">Relacion</TableHead>
                  <TableHead className="text-right">Alertas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts_at_risk.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">
                      <Link href={`/contacts/${contact.id}`} className="text-primary hover:underline">
                        {contact.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.company ?? "—"}</TableCell>
                    <TableCell><RiskBadge level={contact.risk_level} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={scoreToPercent(contact.relationship_score)} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-8 text-right">{contact.relationship_score ?? 0}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{contact.open_alerts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Team Dashboard */}
      {teamMembers.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <UserCog className="h-4 w-4 text-blue-500" />
            <CardTitle>Equipo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Miembro</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead className="text-right">Pendientes</TableHead>
                  <TableHead className="text-right">Vencidas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMembers.map((member: Record<string, unknown>, idx: number) => {
                  const overdue = Number(member.overdue_activities_count ?? member.overdue ?? 0);
                  const pending = Number(member.pending_activities_count ?? member.pending ?? 0);
                  return (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="font-medium">{String(member.name ?? "—")}</div>
                        {member.email ? <div className="text-xs text-muted-foreground">{String(member.email)}</div> : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {String(member.department ?? member.job_title ?? "—")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={pending > 5 ? "warning" : "secondary"}>{pending}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={overdue > 0 ? "critical" : "success"}>{overdue}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Prediction Stats */}
      <PredictionStats />
    </div>
  );
}
