'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, timeAgo } from '@/lib/utils';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Brain,
  Zap,
  BarChart3,
} from 'lucide-react';

interface LearningStats {
  false_positive_rate: number;
  alerts_resolved: number;
  alerts_ignored: number;
  alerts_total: number;
  action_completion_rate: number;
  actions_completed: number;
  actions_dismissed: number;
  chat_satisfaction_rate: number;
  chat_positive_feedback: number;
  chat_negative_feedback: number;
  total_memories: number;
  high_quality_memories: number;
  total_retrievals: number;
  total_calibrations: number;
  calibrations_last_30_days: number;
  total_learnings: number;
  effective_learnings: number;
  reverted_learnings: number;
  avg_improvement_percent: number;
}

interface CalibrationLog {
  id: string;
  alert_type: string;
  reason: string;
  false_positive_rate: number;
  applied_at: string;
}

interface LearningEffectiveness {
  id: string;
  learning_type: string;
  description: string;
  metric_improvement: number;
  is_effective: boolean;
  applied_at: string;
}

export default function LearningPage() {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [calibrations, setCalibrations] = useState<CalibrationLog[]>([]);
  const [learnings, setLearnings] = useState<LearningEffectiveness[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLearningData = async () => {
      try {
        setLoading(true);

        // Fetch system learning stats via RPC
        const { data: statsData, error: statsError } = await supabase.rpc(
          'get_system_learning_stats'
        );

        if (statsError) {
          console.error('Error fetching learning stats:', statsError);
        } else if (statsData) {
          setStats(statsData);
        }

        // Fetch calibration logs
        const { data: calibrationData, error: calibrationError } = await supabase
          .from('alert_calibration_log')
          .select('id, alert_type, reason, false_positive_rate, applied_at')
          .order('applied_at', { ascending: false })
          .limit(10);

        if (calibrationError) {
          console.error('Error fetching calibration logs:', calibrationError);
        } else {
          setCalibrations(calibrationData || []);
        }

        // Fetch learning effectiveness
        const { data: learningData, error: learningError } = await supabase
          .from('learning_effectiveness')
          .select(
            'id, learning_type, description, metric_improvement, is_effective, applied_at'
          )
          .order('applied_at', { ascending: false })
          .limit(10);

        if (learningError) {
          console.error('Error fetching learning effectiveness:', learningError);
        } else {
          setLearnings(learningData || []);
        }
      } catch (error) {
        console.error('Error fetching learning data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLearningData();
  }, []);

  const MetricCard = ({
    icon: Icon,
    label,
    value,
    format = 'default',
    trend,
    isLoading,
  }: {
    icon: React.ComponentType<any>;
    label: string;
    value: number;
    format?: 'percent' | 'count' | 'default';
    trend?: 'up' | 'down' | 'neutral';
    isLoading: boolean;
  }) => {
    let formattedValue = value.toString();
    if (format === 'percent') {
      formattedValue = `${value.toFixed(1)}%`;
    } else if (format === 'count') {
      formattedValue = new Intl.NumberFormat('es-MX').format(value);
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div className="space-y-3 flex-1">
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <p className="text-3xl font-bold text-foreground">
                  {formattedValue}
                </p>
              )}
            </div>
            <div
              className={cn(
                'p-3 rounded-lg',
                trend === 'up' && 'bg-success/10',
                trend === 'down' && 'bg-destructive/10',
                trend === 'neutral' && 'bg-primary/10',
                !trend && 'bg-muted/50'
              )}
            >
              <Icon
                className={cn(
                  'h-6 w-6',
                  trend === 'up' && 'text-success',
                  trend === 'down' && 'text-destructive',
                  trend === 'neutral' && 'text-primary',
                  !trend && 'text-muted-foreground'
                )}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Aprendizaje del Sistema</h1>
        </div>
        <p className="text-muted-foreground">
          Cómo la IA está mejorando y aprendiendo de tus datos
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          icon={AlertTriangle}
          label="Precisión de Alertas"
          value={stats?.false_positive_rate ?? 0}
          format="percent"
          trend={
            (stats?.false_positive_rate ?? 0) < 15
              ? 'up'
              : 'down'
          }
          isLoading={loading}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Efectividad de Acciones"
          value={stats?.action_completion_rate ?? 0}
          format="percent"
          trend="up"
          isLoading={loading}
        />
        <MetricCard
          icon={TrendingUp}
          label="Satisfacción del Chat"
          value={stats?.chat_satisfaction_rate ?? 0}
          format="percent"
          trend="up"
          isLoading={loading}
        />
        <MetricCard
          icon={Brain}
          label="Banco de Memoria"
          value={stats?.total_memories ?? 0}
          format="count"
          isLoading={loading}
        />
        <MetricCard
          icon={Zap}
          label="Calibraciones"
          value={stats?.total_calibrations ?? 0}
          format="count"
          isLoading={loading}
        />
        <MetricCard
          icon={BarChart3}
          label="Aprendizajes Aplicados"
          value={stats?.total_learnings ?? 0}
          format="count"
          isLoading={loading}
        />
      </div>

      {/* Detailed Breakdown Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alert Precision Breakdown */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold text-foreground">
              Precisión de Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Tasa de falsos positivos
                  </span>
                  <span className="text-2xl font-bold text-foreground">
                    {(stats?.false_positive_rate ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="bg-success/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Resueltas</p>
                    <p className="text-2xl font-bold text-success">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.alerts_resolved ?? 0
                      )}
                    </p>
                  </div>
                  <div className="bg-warning/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Ignoradas</p>
                    <p className="text-2xl font-bold text-warning">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.alerts_ignored ?? 0
                      )}
                    </p>
                  </div>
                </div>
                <div className="bg-primary/10 rounded-lg p-4 border border-primary/10">
                  <p className="text-xs text-primary mb-1 font-medium">
                    Total de alertas
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {new Intl.NumberFormat('es-MX').format(
                      stats?.alerts_total ?? 0
                    )}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Effectiveness Breakdown */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold text-foreground">
              Efectividad de Acciones
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Tasa de finalización
                  </span>
                  <span className="text-2xl font-bold text-foreground">
                    {(stats?.action_completion_rate ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="bg-success/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Completadas</p>
                    <p className="text-2xl font-bold text-success">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.actions_completed ?? 0
                      )}
                    </p>
                  </div>
                  <div className="bg-destructive/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Rechazadas</p>
                    <p className="text-2xl font-bold text-destructive">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.actions_dismissed ?? 0
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chat Satisfaction Breakdown */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold text-foreground">
              Satisfacción del Chat
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Calificación promedio
                  </span>
                  <span className="text-2xl font-bold text-foreground">
                    {(stats?.chat_satisfaction_rate ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="bg-success/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Positivo</p>
                    <p className="text-2xl font-bold text-success">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.chat_positive_feedback ?? 0
                      )}
                    </p>
                  </div>
                  <div className="bg-destructive/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Negativo</p>
                    <p className="text-2xl font-bold text-destructive">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.chat_negative_feedback ?? 0
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Memory Bank */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold text-foreground">
              Banco de Memoria
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-primary/10 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total</p>
                    <p className="text-2xl font-bold text-primary">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.total_memories ?? 0
                      )}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Alta Calidad</p>
                    <p className="text-2xl font-bold text-foreground">
                      {new Intl.NumberFormat('es-MX').format(
                        stats?.high_quality_memories ?? 0
                      )}
                    </p>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 border border-border">
                  <p className="text-xs text-foreground mb-1 font-medium">
                    Recuperaciones totales
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {new Intl.NumberFormat('es-MX').format(
                      stats?.total_retrievals ?? 0
                    )}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Learning Improvements */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold text-foreground">
              Aprendizajes Aplicados
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-success/10 rounded-lg p-4">
                  <p className="text-xs text-muted-foreground mb-1">Total</p>
                  <p className="text-2xl font-bold text-success">
                    {new Intl.NumberFormat('es-MX').format(
                      stats?.total_learnings ?? 0
                    )}
                  </p>
                </div>
                <div className="bg-success/10 rounded-lg p-4">
                  <p className="text-xs text-muted-foreground mb-1">Efectivos</p>
                  <p className="text-2xl font-bold text-success">
                    {new Intl.NumberFormat('es-MX').format(
                      stats?.effective_learnings ?? 0
                    )}
                  </p>
                </div>
                <div className="bg-destructive/10 rounded-lg p-4">
                  <p className="text-xs text-muted-foreground mb-1">Revertidos</p>
                  <p className="text-2xl font-bold text-destructive">
                    {new Intl.NumberFormat('es-MX').format(
                      stats?.reverted_learnings ?? 0
                    )}
                  </p>
                </div>
                <div className="bg-warning/10 rounded-lg p-4 border border-border">
                  <p className="text-xs text-warning mb-1 font-medium">
                    Mejora promedio
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {(stats?.avg_improvement_percent ?? 0).toFixed(1)}%
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calibration History Table */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold text-foreground">
            Historial de Calibraciones
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : calibrations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Tipo de Alerta
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Razón
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground">
                      Tasa de Falsos Positivos
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Aplicado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {calibrations.map((cal) => (
                    <tr key={cal.id} className="hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <Badge className="bg-primary/10 text-primary border border-primary/20">
                          {cal.alert_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {cal.reason}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground font-semibold">
                        {(cal.false_positive_rate * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {new Date(cal.applied_at).toLocaleDateString(
                          'es-MX',
                          {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Sin historial de calibraciones
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learning Effectiveness Table */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold text-foreground">
            Aprendizajes Recientes
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : learnings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Tipo de Aprendizaje
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Descripción
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground">
                      Mejora de Métrica
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground">
                      Estado
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">
                      Aplicado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {learnings.map((learning) => (
                    <tr key={learning.id} className="hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <Badge className="bg-muted/50 text-foreground border border-border">
                          {learning.learning_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {learning.description}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={cn(
                            'font-semibold',
                            learning.metric_improvement > 0
                              ? 'text-success'
                              : 'text-destructive'
                          )}
                        >
                          {learning.metric_improvement > 0 ? '+' : ''}
                          {(learning.metric_improvement * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          className={cn(
                            learning.is_effective
                              ? 'bg-success/10 text-success border border-success/20'
                              : 'bg-muted/50 text-foreground border border-border'
                          )}
                        >
                          {learning.is_effective ? 'Efectivo' : 'Pendiente'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {new Date(learning.applied_at).toLocaleDateString(
                          'es-MX',
                          {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Sin aprendizajes recientes
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
