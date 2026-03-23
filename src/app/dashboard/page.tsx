"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo, scoreToPercent } from "@/lib/utils";
import type { DirectorDashboard, DashboardKPI } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { RiskBadge } from "@/components/shared/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, CheckSquare, Users, Mail, AlertTriangle, ClipboardList } from "lucide-react";

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
    supabase.from("alerts").select("id, title, severity, contact_name, description, business_impact, suggested_action, created_at, alert_type").eq("state", "new").in("severity", ["critical", "high"]).order("created_at", { ascending: false }).limit(8),
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

  return {
    kpi,
    critical_alerts: criticalAlertsRes.data ?? [],
    overdue_actions: overdue,
    accountability: [],
    contacts_at_risk: contactsRisk,
    latest_briefing: null,
    pending_actions: [],
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DirectorDashboard | null>(null);
  const [loading, setLoading] = useState(true);

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

  const { kpi, critical_alerts, overdue_actions, contacts_at_risk } = data;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Vista ejecutiva de inteligencia comercial" />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Alertas Criticas" value={kpi.critical_alerts} icon={Bell} description={`${kpi.open_alerts} alertas abiertas en total`} />
        <StatCard title="Acciones Pendientes" value={kpi.pending_actions} icon={CheckSquare} description={`${kpi.overdue_actions} vencidas`} />
        <StatCard title="Contactos en Riesgo" value={kpi.at_risk_contacts} icon={Users} description={`de ${kpi.total_contacts} contactos`} />
        <StatCard title="Emails Procesados" value={kpi.total_emails} icon={Mail} />
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
                  <div key={alert.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
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
                  </div>
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
                    <TableCell className="font-medium">{contact.name}</TableCell>
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
    </div>
  );
}
