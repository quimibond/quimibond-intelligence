'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, timeAgo } from '@/lib/utils';
import {
  Phone,
  Mail,
  Users,
  MessageSquare,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

interface ActionItem {
  id: string;
  description: string;
  action_type: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status?: string;
  state: 'pending' | 'completed' | 'cancelled';
  assignee_name: string | null;
  assignee_email: string | null;
  contact_name: string | null;
  contact_company: string | null;
  due_date: string | null;
  completed_date: string | null;
  completed_at: string | null;
  source_thread_id: string | null;
  reason: string | null;
  created_at: string;
}

type GroupBy = 'date' | 'assignee';
type FilterState = 'pending' | 'completed' | 'cancelled' | 'all';

const ACTION_TYPE_ICONS: Record<string, React.ComponentType<any>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  follow_up: MessageSquare,
  investigate: Search,
  escalate: AlertTriangle,
};

const PRIORITY_LABELS = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>('pending');
  const [groupBy, setGroupBy] = useState<GroupBy>('date');

  useEffect(() => {
    const fetchActions = async () => {
      try {
        setLoading(true);
        let query = supabase
          .from('action_items')
          .select('*')
          .order('due_date', { ascending: true })
          .order('priority', { ascending: true });

        // Apply filter
        if (filterState !== 'all') {
          query = query.eq('state', filterState);
        }

        const { data, error } = await query;

        if (error) throw error;
        setActions(data || []);
      } catch (error) {
        console.error('Error fetching actions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActions();
  }, [filterState]);

  const handleCompleteAction = async (actionId: string) => {
    try {
      const { error } = await supabase
        .from('action_items')
        .update({
          state: 'completed',
          completed_at: new Date().toISOString(),
          completed_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', actionId);

      if (error) throw error;

      setActions((prev) =>
        prev.map((a) =>
          a.id === actionId
            ? {
                ...a,
                state: 'completed' as const,
                completed_at: new Date().toISOString(),
              }
            : a
        )
      );
    } catch (error) {
      console.error('Error completing action:', error);
      alert('Error al completar la acción');
    }
  };

  const handleDismissAction = async (actionId: string) => {
    const reason = prompt('¿Razón del rechazo?');
    if (!reason) return;

    try {
      const { error } = await supabase
        .from('action_items')
        .update({
          state: 'cancelled',
          dismiss_reason: reason,
        })
        .eq('id', actionId);

      if (error) throw error;

      setActions((prev) =>
        prev.map((a) =>
          a.id === actionId
            ? { ...a, state: 'cancelled' as const, reason }
            : a
        )
      );
    } catch (error) {
      console.error('Error dismissing action:', error);
      alert('Error al rechazar la acción');
    }
  };

  const getActionTypeIcon = (type: string) => {
    const Icon = ACTION_TYPE_ICONS[type] || MessageSquare;
    return Icon;
  };

  const getDueDateInfo = (
    dueDate: string | null
  ): { label: string; color: string } => {
    if (!dueDate) return { label: 'Sin fecha', color: 'text-muted-foreground' };

    const now = new Date();
    const due = new Date(dueDate);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffTime = dueDay.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      const absDays = Math.abs(diffDays);
      return {
        label: absDays === 1 ? 'Vencida ayer' : `Vencida hace ${absDays} días`,
        color: 'text-destructive font-semibold',
      };
    }
    if (diffDays === 0) {
      return { label: 'Vence hoy', color: 'text-warning font-semibold' };
    }
    if (diffDays === 1) {
      return { label: 'Vence mañana', color: 'text-warning' };
    }
    if (diffDays <= 7) {
      return {
        label: `Vence en ${diffDays} días`,
        color: 'text-warning',
      };
    }
    return {
      label: `Vence en ${diffDays} días`,
      color: 'text-success',
    };
  };

  const groupActionsByDate = (
    items: ActionItem[]
  ): Record<string, ActionItem[]> => {
    const grouped: Record<string, ActionItem[]> = {
      'Vencidas': [],
      'Hoy': [],
      'Esta semana': [],
      'Más adelante': [],
      'Sin fecha': [],
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    items.forEach((action) => {
      if (!action.due_date) {
        grouped['Sin fecha'].push(action);
        return;
      }

      const due = new Date(action.due_date);
      const dueDay = new Date(
        due.getFullYear(),
        due.getMonth(),
        due.getDate()
      );
      const diffTime = dueDay.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        grouped['Vencidas'].push(action);
      } else if (diffDays === 0) {
        grouped['Hoy'].push(action);
      } else if (diffDays <= 7) {
        grouped['Esta semana'].push(action);
      } else {
        grouped['Más adelante'].push(action);
      }
    });

    return grouped;
  };

  const groupActionsByAssignee = (
    items: ActionItem[]
  ): Record<string, ActionItem[]> => {
    const grouped: Record<string, ActionItem[]> = {};

    items.forEach((action) => {
      const key = action.assignee_name || 'Sin asignar';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(action);
    });

    return grouped;
  };

  const pendingCount = actions.filter((a) => a.state === 'pending').length;
  const completedCount = actions.filter((a) => a.state === 'completed').length;
  const cancelledCount = actions.filter((a) => a.state === 'cancelled').length;

  const filterTabs = [
    { label: 'Pendientes', value: 'pending' as FilterState, count: pendingCount },
    {
      label: 'Completadas',
      value: 'completed' as FilterState,
      count: completedCount,
    },
    {
      label: 'Canceladas',
      value: 'cancelled' as FilterState,
      count: cancelledCount,
    },
    { label: 'Todas', value: 'all' as FilterState, count: actions.length },
  ];

  const groupedActions = groupBy === 'date'
    ? groupActionsByDate(actions)
    : groupActionsByAssignee(actions);

  const ActionCard = ({ action }: { action: ActionItem }) => {
    const ActionIcon = getActionTypeIcon(action.action_type);
    const { label: dateLabel, color: dateColor } = getDueDateInfo(
      action.due_date
    );
    const isCompleted = action.state === 'completed';
    const isCancelled = action.state === 'cancelled';

    return (
      <Card
        className={cn(
          'transition-all',
          isCompleted || isCancelled ? 'opacity-50' : ''
        )}
      >
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Header Row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <ActionIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={action.priority as 'critical' | 'high' | 'medium' | 'low'}
                      className="capitalize shrink-0"
                    >
                      {PRIORITY_LABELS[action.priority]}
                    </Badge>
                    {isCompleted && (
                      <div className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Completada</span>
                      </div>
                    )}
                    {isCancelled && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <XCircle className="h-3 w-3" />
                        <span>Cancelada</span>
                      </div>
                    )}
                  </div>
                  <p
                    className={cn(
                      'text-sm font-medium text-foreground mt-1',
                      isCompleted || isCancelled ? 'line-through text-muted-foreground' : ''
                    )}
                  >
                    {action.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Due Date */}
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className={dateColor}>{dateLabel}</span>
            </div>

            {/* Contact & Assignee */}
            <div className="text-xs text-muted-foreground space-y-1">
              {action.contact_name && (
                <div>
                  <span className="font-medium">Contacto:</span>{' '}
                  <Link
                    href={`/contacts`}
                    className="text-primary hover:underline"
                  >
                    {action.contact_name}
                  </Link>
                  {action.contact_company && (
                    <span className="text-muted-foreground"> • {action.contact_company}</span>
                  )}
                </div>
              )}
              {action.assignee_name && (
                <div>
                  <span className="font-medium">Asignado a:</span>{' '}
                  {action.assignee_name}
                </div>
              )}
            </div>

            {/* Action Buttons - Only for pending */}
            {action.state === 'pending' && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  size="sm"
                  onClick={() => handleCompleteAction(action.id)}
                  className="flex-1 bg-success hover:bg-success/90 text-white text-xs"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Completar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDismissAction(action.id)}
                  className="flex-1 text-xs"
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Rechazar
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">
            Acciones{' '}
            {filterState === 'pending' && pendingCount > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({pendingCount})
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2 bg-card rounded-lg border border-border p-1">
            <button
              onClick={() => setGroupBy('date')}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded transition-colors',
                groupBy === 'date'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Agrupar por fecha"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              onClick={() => setGroupBy('assignee')}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded transition-colors',
                groupBy === 'assignee'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Agrupar por responsable"
            >
              <Users className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-border">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilterState(tab.value)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                filterState === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.count > 0 && <span className="ml-2">({tab.count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {filterState === 'pending'
                ? 'Sin acciones pendientes'
                : 'Sin acciones en esta categoría'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {filterState === 'pending'
                ? '¡Excelente trabajo! No hay acciones pendientes.'
                : 'No hay acciones que mostrar.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedActions).map(([groupName, groupActions]) =>
            groupActions.length > 0 ? (
              <div key={groupName} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {groupName}
                </h2>
                <div className="grid gap-3">
                  {groupActions.map((action) => (
                    <ActionCard key={action.id} action={action} />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
