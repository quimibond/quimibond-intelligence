'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, timeAgo } from '@/lib/utils';
import {
  Mail,
  AlertCircle,
  CheckSquare,
  TrendingUp,
  Clock,
  Users,
  Activity,
} from 'lucide-react';

interface KPIData {
  totalEmails: number;
  activeAlerts: number;
  pendingActions: number;
  riskContacts: number;
  threadsNeedingResponse: number;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  contact_name: string;
  created_at: string;
  business_impact: string;
}

interface ActionItem {
  id: string;
  description: string;
  priority: string;
  state: string;
  assignee_name: string;
  due_date: string;
  contact_name: string;
}

interface ActivitySummary {
  summary_text: string;
  total_emails: number;
  emails_sent: number;
  emails_received: number;
  avg_response_hours: number;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [urgentActions, setUrgentActions] = useState<ActionItem[]>([]);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        // Fetch KPIs
        const [emailsRes, alertsRes, actionsRes, contactsRes, threadsRes] =
          await Promise.all([
            supabase.from('emails').select('id', { count: 'exact', head: true }),
            supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('state', 'new'),
            supabase.from('action_items').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
            supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('risk_level', 'high'),
            supabase.from('email_threads').select('id', { count: 'exact', head: true }).eq('status', 'needs_response'),
          ]);

        setKpis({
          totalEmails: emailsRes.count || 0,
          activeAlerts: alertsRes.count || 0,
          pendingActions: actionsRes.count || 0,
          riskContacts: contactsRes.count || 0,
          threadsNeedingResponse: threadsRes.count || 0,
        });

        // Fetch recent alerts
        const { data: alertsData } = await supabase
          .from('alerts')
          .select(
            'id, alert_type, severity, title, contact_name, created_at, business_impact'
          )
          .order('created_at', { ascending: false })
          .limit(5);

        setRecentAlerts(alertsData || []);

        // Fetch urgent actions
        const { data: actionsData } = await supabase
          .from('action_items')
          .select(
            'id, description, priority, state, assignee_name, due_date, contact_name'
          )
          .eq('state', 'pending')
          .order('priority', { ascending: true })
          .order('due_date', { ascending: true })
          .limit(5);

        setUrgentActions(actionsData || []);

        // Fetch activity summary
        const { data: summaryData } = await supabase
          .from('daily_summaries')
          .select('summary_text, total_emails')
          .order('summary_date', { ascending: false })
          .limit(1)
          .single();

        const { data: metricsData } = await supabase
          .from('response_metrics')
          .select('emails_received, emails_sent, avg_response_hours')
          .order('metric_date', { ascending: false })
          .limit(1)
          .single();

        setActivity({
          summary_text: summaryData?.summary_text || '',
          total_emails: summaryData?.total_emails || 0,
          emails_sent: metricsData?.emails_sent || 0,
          emails_received: metricsData?.emails_received || 0,
          avg_response_hours: metricsData?.avg_response_hours || 0,
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const getSeverityVariant = (
    severity: 'critical' | 'high' | 'medium' | 'low'
  ) => {
    return severity as 'critical' | 'high' | 'medium' | 'low';
  };

  const getPriorityBorder = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'border-l-4 border-l-severity-critical';
      case 'medium':
        return 'border-l-4 border-l-severity-medium';
      case 'low':
        return 'border-l-4 border-l-severity-low';
      default:
        return 'border-l-4 border-l-muted-foreground';
    }
  };

  const KPICard = ({
    icon: Icon,
    label,
    value,
    isLoading,
  }: {
    icon: React.ComponentType<any>;
    label: string;
    value: number;
    isLoading: boolean;
  }) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold text-foreground">{value}</p>
            )}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Inteligencia comercial en tiempo real
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          icon={Mail}
          label="Total Correos"
          value={kpis?.totalEmails || 0}
          isLoading={loading}
        />
        <KPICard
          icon={AlertCircle}
          label="Alertas Activas"
          value={kpis?.activeAlerts || 0}
          isLoading={loading}
        />
        <KPICard
          icon={CheckSquare}
          label="Acciones Pendientes"
          value={kpis?.pendingActions || 0}
          isLoading={loading}
        />
        <KPICard
          icon={Users}
          label="Contactos en Riesgo"
          value={kpis?.riskContacts || 0}
          isLoading={loading}
        />
        <KPICard
          icon={Clock}
          label="Threads sin Respuesta"
          value={kpis?.threadsNeedingResponse || 0}
          isLoading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Recent Alerts */}
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">
                  Alertas Recientes
                </CardTitle>
                <Link
                  href="/alerts"
                  className="text-sm text-primary hover:text-primary/80 font-medium"
                >
                  Ver todas
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-4 pt-6">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : recentAlerts.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentAlerts.map((alert) => (
                    <Link
                      key={alert.id}
                      href={`/alerts?id=${alert.id}`}
                      className="block py-4 hover:bg-muted/50 transition-colors px-0 first:pt-4 last:pb-0"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-foreground truncate">
                              {alert.title}
                            </h3>
                            <Badge
                              variant={getSeverityVariant(alert.severity)}
                              className="capitalize shrink-0"
                            >
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {alert.contact_name} •{' '}
                            {timeAgo(alert.created_at)}
                          </p>
                          {alert.business_impact && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              {alert.business_impact}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Sin alertas activas
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Summary */}
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Resumen de Actividad
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : activity ? (
                <div className="space-y-6">
                  {activity.summary_text && (
                    <p className="text-sm text-foreground leading-relaxed">
                      {activity.summary_text}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-1">
                        Correos Recibidos
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {activity.emails_received}
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs text-muted-foreground mb-1">
                        Correos Enviados
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {activity.emails_sent}
                      </p>
                    </div>
                  </div>
                  <div className="bg-primary/5 rounded-lg p-4 border border-primary/10">
                    <p className="text-xs text-primary mb-1 font-medium">
                      Tiempo promedio de respuesta
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {activity.avg_response_hours.toFixed(1)} horas
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Sin datos disponibles
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div>
          {/* Urgent Actions */}
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">
                  Acciones Urgentes
                </CardTitle>
                <Link
                  href="/actions"
                  className="text-sm text-primary hover:text-primary/80 font-medium"
                >
                  Ver todas
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-3 pt-6">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : urgentActions.length > 0 ? (
                <div className="space-y-3 pt-4">
                  {urgentActions.map((action) => (
                    <Link
                      key={action.id}
                      href={`/actions?id=${action.id}`}
                      className={cn(
                        'block p-3 rounded-lg transition-colors cursor-pointer hover:opacity-90 bg-muted/50',
                        getPriorityBorder(action.priority)
                      )}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground line-clamp-2">
                          {action.description}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{action.contact_name}</span>
                          {action.due_date && (
                            <span>
                              {new Date(action.due_date).toLocaleDateString(
                                'es-MX'
                              )}
                            </span>
                          )}
                        </div>
                        {action.assignee_name && (
                          <p className="text-xs text-muted-foreground">
                            Asignado a: {action.assignee_name}
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Sin acciones pendientes
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
