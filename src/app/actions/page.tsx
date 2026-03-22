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
  ToggleLeft,
  ToggleRight,
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

const PRIORITY_COLORS = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-blue-100 text-blue-800 border-blue-300',
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
    if (!dueDate) return { label: 'Sin fecha', color: 'text-gray-400' };

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
        color: 'text-red-600 font-semibold',
      };
    }
    if (diffDays === 0) {
      return { label: 'Vence hoy', color: 'text-yellow-600 font-semibold' };
    }
    if (diffDays === 1) {
      return { label: 'Vence mañana', color: 'text-yellow-600' };
    }
    if (diffDays <= 7) {
      return {
        label: `Vence en ${diffDays} días`,
        color: 'text-yellow-600',
      };
    }
    return {
      label: `Vence en ${diffDays} días`,
      color: 'text-green-600',
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
          'border border-gray-200 transition-all',
          isCompleted || isCancelled ? 'opacity-50' : ''
        )}
      >
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Header Row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                  <ActionIcon className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      className={cn(
                        'capitalize shrink-0',
                        PRIORITY_COLORS[action.priority]
                      )}
                    >
                      {PRIORITY_LABELS[action.priority]}
                    </Badge>
                    {isCompleted && (
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Completada</span>
                      </div>
                    )}
                    {isCancelled && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <XCircle className="h-3 w-3" />
                        <span>Cancelada</span>
                      </div>
                    )}
                  </div>
                  <p
                    className={cn(
                      'text-sm font-medium text-gray-900 mt-1',
                      isCompleted || isCancelled ? 'line-through text-gray-500' : ''
                    )}
                  >
                    {action.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Due Date */}
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3 w-3 text-gray-400" />
              <span className={dateColor}>{dateLabel}</span>
            </div>

            {/* Contact & Assignee */}
            <div className="text-xs text-gray-600 space-y-1">
              {action.contact_name && (
                <div>
                  <span className="font-medium">Contacto:</span>{' '}
                  <Link
                    href={`/contacts`}
                    className="text-blue-600 hover:underline"
                  >
                    {action.contact_name}
                  </Link>
                  {action.contact_company && (
                    <span className="text-gray-500"> • {action.contact_company}</span>
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
              <div className="flex gap-2 pt-2 border-t border-gray-200">
                <Button
                  size="sm"
                  onClick={() => handleCompleteAction(action.id)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs"
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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">
              Acciones{' '}
              {filterState === 'pending' && pendingCount > 0 && (
                <span className="text-sm font-normal text-gray-600">
                  ({pendingCount})
                </span>
              )}
            </h1>
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => setGroupBy('date')}
                className={cn(
                  'px-3 py-1 text-sm font-medium rounded transition-colors',
                  groupBy === 'date'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900'
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
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900'
                )}
                title="Agrupar por responsable"
              >
                <Users className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 border-b border-gray-200">
            {filterTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilterState(tab.value)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  filterState === tab.value
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
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
          <Card className="border border-gray-200 bg-white">
            <CardContent className="py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {filterState === 'pending'
                  ? 'Sin acciones pendientes'
                  : 'Sin acciones en esta categoría'}
              </h3>
              <p className="text-sm text-gray-500">
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
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
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
    </div>
  );
}
