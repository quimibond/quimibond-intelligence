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

  const getSeverityColor = (
    severity: 'critical' | 'high' | 'medium' | 'low'
  ) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-50 border-l-4 border-red-500';
      case 'medium':
        return 'bg-yellow-50 border-l-4 border-yellow-500';
      case 'low':
        return 'bg-green-50 border-l-4 border-green-500';
      default:
        return 'bg-gray-50 border-l-4 border-gray-400';
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
    <Card className="border border-gray-200">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-600">{label}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold text-gray-900">{value}</p>
            )}
          </div>
          <Icon className="h-8 w-8 text-gray-400" />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">
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
            <Card className="border border-gray-200">
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    Alertas Recientes
                  </CardTitle>
                  <Link
                    href="/alerts"
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
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
                  <div className="divide-y divide-gray-200">
                    {recentAlerts.map((alert) => (
                      <Link
                        key={alert.id}
                        href={`/alerts?id=${alert.id}`}
                        className="block py-4 hover:bg-gray-50 transition-colors px-0 first:pt-4 last:pb-0"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold text-gray-900 truncate">
                                {alert.title}
                              </h3>
                              <Badge
                                className={cn(
                                  'capitalize shrink-0',
                                  getSeverityColor(alert.severity)
                                )}
                              >
                                {alert.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-500">
                              {alert.contact_name} •{' '}
                              {timeAgo(alert.created_at)}
                            </p>
                            {alert.business_impact && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-1">
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
                    <p className="text-sm text-gray-500">
                      Sin alertas activas
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Activity Summary */}
            <Card className="border border-gray-200">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
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
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {activity.summary_text}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-xs text-gray-600 mb-1">
                          Correos Recibidos
                        </p>
                        <p className="text-2xl font-bold text-gray-900">
                          {activity.emails_received}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-xs text-gray-600 mb-1">
                          Correos Enviados
                        </p>
                        <p className="text-2xl font-bold text-gray-900">
                          {activity.emails_sent}
                        </p>
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                      <p className="text-xs text-blue-700 mb-1 font-medium">
                        Tiempo promedio de respuesta
                      </p>
                      <p className="text-2xl font-bold text-blue-900">
                        {activity.avg_response_hours.toFixed(1)} horas
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <p className="text-sm text-gray-500">
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
            <Card className="border border-gray-200">
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    Acciones Urgentes
                  </CardTitle>
                  <Link
                    href="/actions"
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
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
                          'block p-3 rounded-lg transition-colors cursor-pointer hover:opacity-90',
                          getPriorityColor(action.priority)
                        )}
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-gray-900 line-clamp-2">
                            {action.description}
                          </p>
                          <div className="flex items-center justify-between text-xs text-gray-600">
                            <span>{action.contact_name}</span>
                            {action.due_date && (
                              <span className="text-gray-500">
                                {new Date(action.due_date).toLocaleDateString(
                                  'es-MX'
                                )}
                              </span>
                            )}
                          </div>
                          {action.assignee_name && (
                            <p className="text-xs text-gray-500">
                              Asignado a: {action.assignee_name}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <p className="text-sm text-gray-500">
                      Sin acciones pendientes
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
