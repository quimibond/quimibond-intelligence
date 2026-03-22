"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import Link from "next/link";
import {
  Target,
  Check,
  Clock,
  CheckSquare,
  Activity,
  Flame,
  Phone,
  Mail,
  Users,
  Search,
  FileText,
  MessageSquare,
  AlertTriangle,
  Zap,
  Eye,
  Send,
  Handshake,
  Truck,
  HelpCircle,
  X,
  User,
  Building2,
  CalendarClock,
} from "lucide-react";

interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string | null;
  contact_id: string | null;
  contact_company: string | null;
  priority: string;
  due_date: string | null;
  state: string;
  status: string;
  assignee_email: string | null;
  assignee_name: string | null;
  reason: string | null;
  created_at: string;
  completed_date: string | null;
  source_thread_id: string | null;
  source_alert_id: string | null;
}

const actionTypeConfig: Record<string, { icon: typeof Phone; label: string }> = {
  call: { icon: Phone, label: "Llamar" },
  email: { icon: Mail, label: "Email" },
  meeting: { icon: Users, label: "Reunion" },
  quote: { icon: FileText, label: "Cotizar" },
  send_quote: { icon: Send, label: "Enviar cotizacion" },
  send_invoice: { icon: FileText, label: "Enviar factura" },
  follow_up: { icon: MessageSquare, label: "Seguimiento" },
  escalate: { icon: AlertTriangle, label: "Escalar" },
  investigate: { icon: Search, label: "Investigar" },
  negotiate: { icon: Handshake, label: "Negociar" },
  deliver: { icon: Truck, label: "Entregar" },
  apologize: { icon: Handshake, label: "Disculparse" },
  review: { icon: Eye, label: "Revisar" },
  approve: { icon: Check, label: "Aprobar" },
  pay: { icon: Zap, label: "Pagar" },
};

const priorityToBadge: Record<string, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

type GroupBy = "date" | "assignee";

function getDaysUntilDue(dueDate: string): number {
  return Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(action: ActionItem): boolean {
  return action.state === "pending" && !!action.due_date && getDaysUntilDue(action.due_date) < 0;
}

function groupByDate(actions: ActionItem[]): { label: string; actions: ActionItem[] }[] {
  const groups: Record<string, ActionItem[]> = {};

  for (const action of actions) {
    let key: string;
    if (!action.due_date) {
      key = "Sin fecha";
    } else {
      const days = getDaysUntilDue(action.due_date);
      if (days < 0) key = "Vencidas";
      else if (days === 0) key = "Hoy";
      else if (days === 1) key = "Manana";
      else if (days <= 7) key = "Esta semana";
      else key = "Mas adelante";
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(action);
  }

  const order = ["Vencidas", "Hoy", "Manana", "Esta semana", "Mas adelante", "Sin fecha"];
  return order
    .filter((k) => groups[k]?.length)
    .map((k) => ({ label: k, actions: groups[k] }));
}

function groupByAssignee(
  actions: ActionItem[]
): { email: string; displayName: string; actions: ActionItem[]; pendingCount: number; overdueCount: number }[] {
  const groups: Record<string, ActionItem[]> = {};

  for (const action of actions) {
    const key = action.assignee_email || "Sin asignar";
    if (!groups[key]) groups[key] = [];
    groups[key].push(action);
  }

  return Object.entries(groups)
    .map(([email, items]) => {
      const first = items.find((a) => a.assignee_name);
      return {
        email,
        displayName: first?.assignee_name || email,
        actions: items,
        pendingCount: items.filter((a) => a.state === "pending").length,
        overdueCount: items.filter(isOverdue).length,
      };
    })
    .sort((a, b) => b.overdueCount - a.overdueCount || b.pendingCount - a.pendingCount);
}

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("pending");
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [counts, setCounts] = useState({ pending: 0, completed: 0, dismissed: 0, all: 0 });

  useEffect(() => {
    async function fetchActions() {
      let query = supabase
        .from("action_items")
        .select("*")
        .order("due_date", { ascending: true })
        .limit(100);

      if (stateFilter !== "all") {
        query = query.eq("state", stateFilter);
      }

      const { data } = await query;
      setActions(data || []);
      setLoading(false);
    }

    async function fetchCounts() {
      const [pRes, cRes, dRes, aRes] = await Promise.all([
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "dismissed"),
        supabase.from("action_items").select("id", { count: "exact", head: true }),
      ]);
      setCounts({
        pending: pRes.count ?? 0,
        completed: cRes.count ?? 0,
        dismissed: dRes.count ?? 0,
        all: aRes.count ?? 0,
      });
    }

    fetchActions();
    fetchCounts();
  }, [stateFilter]);

  async function completeAction(id: string) {
    await supabase
      .from("action_items")
      .update({ state: "completed", completed_date: new Date().toISOString() })
      .eq("id", id);
    setActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, state: "completed", completed_date: new Date().toISOString() } : a
      )
    );
    setCounts((c) => ({ ...c, pending: Math.max(0, c.pending - 1), completed: c.completed + 1 }));
  }

  async function dismissAction(id: string) {
    await supabase.from("action_items").update({ state: "dismissed" }).eq("id", id);
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, state: "dismissed" } : a)));
    setCounts((c) => ({ ...c, pending: Math.max(0, c.pending - 1), dismissed: c.dismissed + 1 }));
  }

  const overdueCount = useMemo(
    () => actions.filter(isOverdue).length,
    [actions]
  );

  const stateFilters = [
    { key: "pending", label: "Pendientes", count: counts.pending },
    { key: "completed", label: "Completadas", count: counts.completed },
    { key: "dismissed", label: "Descartadas", count: counts.dismissed },
    { key: "all", label: "Todas", count: counts.all },
  ];

  const groupByOptions: { key: GroupBy; label: string }[] = [
    { key: "date", label: "Por fecha" },
    { key: "assignee", label: "Por responsable" },
  ];

  const dateGroups = useMemo(() => groupByDate(actions), [actions]);
  const assigneeGroups = useMemo(() => groupByAssignee(actions), [actions]);

  function renderActionCard(action: ActionItem) {
    const typeConf = actionTypeConfig[action.action_type] || { icon: HelpCircle, label: action.action_type };
    const TypeIcon = typeConf.icon;
    const actionOverdue = isOverdue(action);
    const daysLeft = action.due_date ? getDaysUntilDue(action.due_date) : null;
    const isCompleted = action.state === "completed";
    const isDismissed = action.state === "dismissed";

    const rarityClass =
      isCompleted || isDismissed
        ? ""
        : action.priority === "high" || action.priority === "critical"
          ? "mission-epic"
          : action.priority === "medium"
            ? "mission-rare"
            : "mission-common";

    return (
      <Card
        key={action.id}
        className={cn(
          "transition-all",
          rarityClass,
          actionOverdue && "border-l-3 border-l-[var(--destructive)]",
          isCompleted && "opacity-70",
          isDismissed && "opacity-50"
        )}
        style={actionOverdue ? { backgroundColor: "var(--severity-critical-muted)" } : undefined}
      >
        <CardContent className="flex items-start gap-4 p-4">
          {/* Type icon */}
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              isCompleted ? "bg-[var(--success-muted)]" : "bg-[var(--secondary)]"
            )}
          >
            {isCompleted ? (
              <Check className="h-5 w-5 text-[var(--success)]" />
            ) : (
              <TypeIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge
                variant={
                  isCompleted
                    ? "success"
                    : isDismissed
                      ? "secondary"
                      : priorityToBadge[action.priority] || "low"
                }
              >
                {isCompleted ? "Completada" : isDismissed ? "Descartada" : action.priority}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <TypeIcon className="h-3 w-3" />
                {typeConf.label}
              </Badge>
              {actionOverdue && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                  <Flame className="h-3 w-3" />
                  VENCIDA
                </span>
              )}
            </div>

            {/* Description */}
            <p className={cn("text-sm", isCompleted && "line-through opacity-70")}>
              {action.description}
            </p>

            {/* Reason (WHY) */}
            {action.reason && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)] italic">
                Por que? {action.reason}
              </p>
            )}

            {/* WHO / WHEN details */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
              {/* Responsable */}
              {(action.assignee_name || action.assignee_email) && (
                <span className="flex items-center gap-1 font-medium text-[var(--foreground)]">
                  <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  {action.assignee_name || action.assignee_email}
                </span>
              )}

              {/* Contacto */}
              {action.contact_name && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {action.contact_id ? (
                    <Link
                      href={`/contacts/${action.contact_id}`}
                      className="underline underline-offset-2 hover:text-[var(--foreground)] transition-colors"
                    >
                      {action.contact_name}
                      {action.contact_company ? ` — ${action.contact_company}` : ""}
                    </Link>
                  ) : (
                    <span>
                      {action.contact_name}
                      {action.contact_company ? ` — ${action.contact_company}` : ""}
                    </span>
                  )}
                </span>
              )}

              {/* Due date / WHEN */}
              {action.due_date && !isCompleted && !isDismissed && (
                <span
                  className={cn(
                    "flex items-center gap-1",
                    actionOverdue
                      ? "text-[var(--destructive)] font-bold"
                      : daysLeft !== null && daysLeft <= 1
                        ? "text-[var(--warning)] font-medium"
                        : ""
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {actionOverdue
                    ? `Vencida hace ${Math.abs(daysLeft!)} dia${Math.abs(daysLeft!) !== 1 ? "s" : ""}`
                    : daysLeft === 0
                      ? "Vence hoy"
                      : daysLeft === 1
                        ? "Vence manana"
                        : `Vence en ${daysLeft} dias`}
                  <span className="font-normal text-[var(--muted-foreground)]">
                    ({formatDueDate(action.due_date)})
                  </span>
                </span>
              )}

              {/* Completed date */}
              {action.completed_date && (
                <span className="text-[var(--success)]">
                  Completada {timeAgo(action.completed_date)}
                </span>
              )}

              {/* Created */}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(action.created_at)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          {action.state === "pending" && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => completeAction(action.id)}
                title="Completar"
                className="h-8 w-8 hover:text-[var(--success)]"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => dismissAction(action.id)}
                title="Descartar"
                className="h-8 w-8"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Target className="h-6 w-6 text-[var(--quest-epic)]" />
            <h1 className="text-2xl font-black tracking-tight">Tablero de Misiones</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Acciones sugeridas por el sistema de inteligencia
          </p>
        </div>
        {overdueCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--destructive)] bg-[var(--severity-critical-muted)] px-3 py-1.5">
            <Flame className="h-4 w-4 text-[var(--destructive)]" />
            <span className="text-sm font-bold text-[var(--destructive)]">
              {overdueCount} vencida{overdueCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Filters + Group-by row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* State filters */}
        <div className="flex items-center gap-1">
          {stateFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setStateFilter(f.key);
                setLoading(true);
              }}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                stateFilter === f.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Group-by toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
          {groupByOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGroupBy(opt.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                groupBy === opt.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-[var(--quest-epic)] animate-pulse" />
        </div>
      ) : actions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckSquare className="h-12 w-12 mb-3 text-[var(--success)] opacity-40" />
            <p className="text-sm font-medium">Todas las misiones completadas</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              No hay acciones en esta categoria
            </p>
          </CardContent>
        </Card>
      ) : groupBy === "date" ? (
        <div className="space-y-6">
          {dateGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                {group.label === "Vencidas" && <Flame className="h-4 w-4 text-[var(--destructive)]" />}
                {group.label}
                <span className="text-xs font-normal">({group.actions.length})</span>
              </h2>
              {group.actions.map(renderActionCard)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {assigneeGroups.map((group) => (
            <div key={group.email} className="space-y-2">
              <div className="flex items-center gap-2 pb-1 border-b border-[var(--border)]">
                <User className="h-4 w-4 text-[var(--muted-foreground)]" />
                <h2 className="text-sm font-semibold text-[var(--foreground)]">
                  {group.displayName}
                  {group.displayName !== group.email && (
                    <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                      ({group.email})
                    </span>
                  )}
                </h2>
                <span className="text-xs text-[var(--muted-foreground)]">
                  — {group.pendingCount} pendiente{group.pendingCount !== 1 ? "s" : ""}
                  {group.overdueCount > 0 && (
                    <span className="text-[var(--destructive)] font-bold ml-1">
                      , {group.overdueCount} vencida{group.overdueCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </div>
              {group.actions.map(renderActionCard)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
