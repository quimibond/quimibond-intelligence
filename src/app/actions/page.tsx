"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
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
} from "lucide-react";

interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string;
  priority: string;
  due_date: string;
  state: string;
  status: string;
  assignee_email: string;
  created_at: string;
  completed_date: string | null;
}

const actionTypeConfig: Record<string, { icon: typeof Phone; label: string; color: string }> = {
  call: { icon: Phone, label: "Llamar", color: "text-blue-400" },
  email: { icon: Mail, label: "Email", color: "text-cyan-400" },
  meeting: { icon: Users, label: "Reunion", color: "text-purple-400" },
  quote: { icon: FileText, label: "Cotizar", color: "text-amber-400" },
  send_quote: { icon: Send, label: "Enviar cotizacion", color: "text-amber-400" },
  send_invoice: { icon: FileText, label: "Enviar factura", color: "text-green-400" },
  follow_up: { icon: MessageSquare, label: "Seguimiento", color: "text-indigo-400" },
  escalate: { icon: AlertTriangle, label: "Escalar", color: "text-red-400" },
  investigate: { icon: Search, label: "Investigar", color: "text-teal-400" },
  negotiate: { icon: Handshake, label: "Negociar", color: "text-pink-400" },
  deliver: { icon: Truck, label: "Entregar", color: "text-emerald-400" },
  apologize: { icon: Handshake, label: "Disculparse", color: "text-rose-400" },
  review: { icon: Eye, label: "Revisar", color: "text-gray-400" },
  approve: { icon: Check, label: "Aprobar", color: "text-emerald-400" },
  pay: { icon: Zap, label: "Pagar", color: "text-amber-400" },
};

function getPriorityConfig(priority: string) {
  switch (priority) {
    case "high": case "critical":
      return { color: "text-red-400", bg: "bg-red-500/10", border: "border-l-red-500", rarity: "mission-epic", label: "CRITICA" };
    case "medium":
      return { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-400", rarity: "mission-rare", label: "IMPORTANTE" };
    default:
      return { color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-l-cyan-400", rarity: "mission-common", label: "NORMAL" };
  }
}

function getDaysUntilDue(dueDate: string): number {
  return Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
}

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("pending");
  const [counts, setCounts] = useState({ pending: 0, completed: 0, dismissed: 0, all: 0 });

  useEffect(() => {
    async function fetchActions() {
      let query = supabase
        .from("action_items")
        .select("*")
        .order("due_date", { ascending: true })
        .limit(50);

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

  const overdue = actions.filter((a) => a.state === "pending" && a.due_date && getDaysUntilDue(a.due_date) < 0).length;

  const stateFilters = [
    { key: "pending", label: "Pendientes", count: counts.pending, color: "text-amber-400" },
    { key: "completed", label: "Completadas", count: counts.completed, color: "text-emerald-400" },
    { key: "dismissed", label: "Descartadas", count: counts.dismissed, color: "text-gray-400" },
    { key: "all", label: "Todas", count: counts.all, color: "text-[var(--muted-foreground)]" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Target className="h-6 w-6 text-purple-400" />
            <h1 className="text-2xl font-black tracking-tight">Tablero de Misiones</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Acciones sugeridas por el sistema de inteligencia
          </p>
        </div>
        {overdue > 0 && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <Flame className="h-4 w-4" />
            <span className="font-bold">{overdue} vencidas</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1">
        {stateFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setStateFilter(f.key); setLoading(true); }}
            className={cn(
              "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
              stateFilter === f.key
                ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50",
            )}
          >
            {f.label}
            <span className={cn("ml-1 tabular-nums", f.color)}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* Action List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-purple-400 animate-pulse" />
        </div>
      ) : actions.length === 0 ? (
        <div className="game-card rounded-lg bg-[var(--card)] p-12 text-center">
          <CheckSquare className="h-12 w-12 mx-auto mb-3 text-emerald-400 opacity-40" />
          <p className="text-sm font-medium">Todas las misiones completadas</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">No hay acciones en esta categoria</p>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const config = getPriorityConfig(action.priority);
            const typeConf = actionTypeConfig[action.action_type] || { icon: HelpCircle, label: action.action_type, color: "text-gray-400" };
            const TypeIcon = typeConf.icon;
            const isOverdue = action.state === "pending" && action.due_date && getDaysUntilDue(action.due_date) < 0;
            const daysLeft = action.due_date ? getDaysUntilDue(action.due_date) : null;
            const isCompleted = action.state === "completed";
            const isDismissed = action.state === "dismissed";

            return (
              <div
                key={action.id}
                className={cn(
                  "game-card rounded-lg bg-[var(--card)] p-4 border-l-3 transition-all",
                  isCompleted ? "border-l-emerald-500 opacity-70" :
                  isDismissed ? "border-l-gray-500 opacity-50" :
                  isOverdue ? "border-l-red-500" : config.border,
                  isOverdue && "bg-red-500/5",
                  !isCompleted && !isDismissed && config.rarity,
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Type icon */}
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isCompleted ? "bg-emerald-500/15" : config.bg,
                  )}>
                    {isCompleted ? (
                      <Check className="h-5 w-5 text-emerald-400" />
                    ) : (
                      <TypeIcon className={cn("h-5 w-5", typeConf.color)} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider", isCompleted ? "text-emerald-400" : config.color)}>
                        {isCompleted ? "COMPLETADA" : isDismissed ? "DESCARTADA" : config.label}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {typeConf.label}
                      </Badge>
                      {action.contact_name && (
                        <span className="text-xs text-[var(--muted-foreground)]">{action.contact_name}</span>
                      )}
                      {isOverdue && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
                          <Flame className="h-3 w-3" />
                          VENCIDA
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className={cn("text-sm", isCompleted && "line-through opacity-70")}>{action.description}</p>

                    {/* Meta */}
                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                      <span>{timeAgo(action.created_at)}</span>
                      {action.due_date && !isCompleted && (
                        <span className={cn(
                          "flex items-center gap-1",
                          isOverdue ? "text-red-400 font-bold" :
                          daysLeft !== null && daysLeft <= 1 ? "text-amber-400" : "",
                        )}>
                          <Clock className="h-3 w-3" />
                          {isOverdue
                            ? `Vencida hace ${Math.abs(daysLeft!)} dia${Math.abs(daysLeft!) !== 1 ? "s" : ""}`
                            : daysLeft === 0
                              ? "Vence hoy"
                              : daysLeft === 1
                                ? "Vence manana"
                                : `Vence en ${daysLeft} dias`
                          }
                        </span>
                      )}
                      {action.assignee_email && (
                        <span className="hidden sm:inline">Asignado: {action.assignee_email}</span>
                      )}
                      {action.completed_date && (
                        <span className="text-emerald-400">
                          Completada {timeAgo(action.completed_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {action.state === "pending" && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => completeAction(action.id)}
                        title="Completar mision"
                        className="h-8 w-8 hover:text-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => dismissAction(action.id)}
                        title="Descartar"
                        className="h-8 w-8 hover:text-gray-400"
                      >
                        <span className="text-xs">✕</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
