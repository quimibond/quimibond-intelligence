"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import {
  Mail,
  AlertTriangle,
  CheckSquare,
  Users,
  TrendingUp,
  FileText,
} from "lucide-react";
import Link from "next/link";

interface Stats {
  totalEmails: number;
  openAlerts: number;
  pendingActions: number;
  atRiskContacts: number;
}

interface Briefing {
  id: string;
  briefing_type: string;
  period_start: string;
  period_end: string;
  html_content: string;
  created_at: string;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  contact_name: string;
  created_at: string;
  is_read: boolean;
}

interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string;
  priority: string;
  due_date: string;
  state: string;
}

const severityVariant: Record<string, "destructive" | "warning" | "info"> = {
  critical: "destructive",
  high: "destructive",
  medium: "warning",
  low: "info",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalEmails: 0,
    openAlerts: 0,
    pendingActions: 0,
    atRiskContacts: 0,
  });
  const [latestBriefing, setLatestBriefing] = useState<Briefing | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [pendingActions, setPendingActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [emailsRes, alertsRes, actionsRes, contactsRes, briefingRes, recentAlertsRes, actionsListRes] =
        await Promise.all([
          supabase.from("emails").select("id", { count: "exact", head: true }),
          supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
          supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
          supabase.from("contacts").select("id", { count: "exact", head: true }).eq("risk_level", "high"),
          supabase.from("briefings").select("*").order("created_at", { ascending: false }).limit(1),
          supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(5),
          supabase.from("action_items").select("*").eq("state", "pending").order("due_date", { ascending: true }).limit(5),
        ]);

      setStats({
        totalEmails: emailsRes.count ?? 0,
        openAlerts: alertsRes.count ?? 0,
        pendingActions: actionsRes.count ?? 0,
        atRiskContacts: contactsRes.count ?? 0,
      });

      if (briefingRes.data?.[0]) setLatestBriefing(briefingRes.data[0]);
      if (recentAlertsRes.data) setRecentAlerts(recentAlertsRes.data);
      if (actionsListRes.data) setPendingActions(actionsListRes.data);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-[var(--muted-foreground)]">Cargando dashboard...</div>
      </div>
    );
  }

  const statCards = [
    { label: "Emails procesados", value: stats.totalEmails.toLocaleString(), icon: Mail, color: "text-blue-400" },
    { label: "Alertas abiertas", value: stats.openAlerts, icon: AlertTriangle, color: "text-amber-400" },
    { label: "Acciones pendientes", value: stats.pendingActions, icon: CheckSquare, color: "text-emerald-400" },
    { label: "Contactos en riesgo", value: stats.atRiskContacts, icon: Users, color: "text-red-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Vista general de inteligencia comercial</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Latest Briefing */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Ultimo Briefing
            </CardTitle>
            <Link href="/briefings" className="text-xs text-[var(--primary)] hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {latestBriefing ? (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="info">{latestBriefing.briefing_type}</Badge>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {timeAgo(latestBriefing.created_at)}
                  </span>
                </div>
                <div
                  className="prose prose-invert prose-sm max-h-48 overflow-hidden text-sm"
                  dangerouslySetInnerHTML={{ __html: latestBriefing.html_content?.slice(0, 500) || "" }}
                />
                <Link
                  href={`/briefings/${latestBriefing.id}`}
                  className="mt-2 inline-block text-xs text-[var(--primary)] hover:underline"
                >
                  Leer completo
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No hay briefings aun.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Alertas recientes
            </CardTitle>
            <Link href="/alerts" className="text-xs text-[var(--primary)] hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardContent>
            {recentAlerts.length > 0 ? (
              <div className="space-y-3">
                {recentAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-3 rounded-md border border-[var(--border)] p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={severityVariant[alert.severity] || "info"} className="text-[10px]">
                          {alert.severity}
                        </Badge>
                        <span className="text-xs text-[var(--muted-foreground)]">{alert.contact_name}</span>
                      </div>
                      <p className="text-sm truncate">{alert.title}</p>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                      {timeAgo(alert.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No hay alertas recientes.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Actions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Acciones pendientes
          </CardTitle>
          <Link href="/actions" className="text-xs text-[var(--primary)] hover:underline">
            Ver todas
          </Link>
        </CardHeader>
        <CardContent>
          {pendingActions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                    <th className="pb-2 pr-4">Accion</th>
                    <th className="pb-2 pr-4">Contacto</th>
                    <th className="pb-2 pr-4">Prioridad</th>
                    <th className="pb-2">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingActions.map((action) => (
                    <tr key={action.id} className="border-b border-[var(--border)]/50">
                      <td className="py-2 pr-4 max-w-xs truncate">{action.description}</td>
                      <td className="py-2 pr-4 text-[var(--muted-foreground)]">{action.contact_name}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={
                            action.priority === "high" ? "destructive" : action.priority === "medium" ? "warning" : "info"
                          }
                        >
                          {action.priority}
                        </Badge>
                      </td>
                      <td className="py-2 text-[var(--muted-foreground)]">
                        {action.due_date
                          ? new Date(action.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No hay acciones pendientes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
