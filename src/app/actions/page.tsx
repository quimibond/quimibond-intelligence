"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
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
  X,
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
    { key: "pending", label: "Pendientes", count: counts.pending },
    { key: "completed", label: "Completadas", count: counts.completed },
    { key: "dismissed", label: "Descartadas", count: counts.dismissed },
    { key: "all", label: "Todas", count: counts.all },
  ];

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
        {overdue > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--destructive)]">
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
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            {f.label}
            <span className="ml-1 tabular-nums">{f.count}</span>
          </button>
        ))}
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
            <p className="text-xs text-[var(--muted-foreground)] mt-1">No hay acciones en esta categoria</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const typeConf = actionTypeConfig[action.action_type] || { icon: HelpCircle, label: action.action_type };
            const TypeIcon = typeConf.icon;
            const isOverdue = action.state === "pending" && action.due_date && getDaysUntilDue(action.due_date) < 0;
            const daysLeft = action.due_date ? getDaysUntilDue(action.due_date) : null;
            const isCompleted = action.state === "completed";
            const isDismissed = action.state === "dismissed";

            const rarityClass = isCompleted || isDismissed ? "" :
              action.priority === "high" || action.priority === "critical" ? "mission-epic" :
              action.priority === "medium" ? "mission-rare" : "mission-common";

            return (
              <Card
                key={action.id}
                className={cn(
                  "transition-all",
                  rarityClass,
                  isOverdue && "border-l-3 border-l-[var(--destructive)]",
                  isCompleted && "opacity-70",
                  isDismissed && "opacity-50",
                )}
                style={isOverdue ? { backgroundColor: "var(--severity-critical-muted)" } : undefined}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  {/* Type icon */}
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isCompleted ? "bg-[var(--success-muted)]" : "bg-[var(--secondary)]",
                  )}>
                    {isCompleted ? (
                      <Check className="h-5 w-5 text-[var(--success)]" />
                    ) : (
                      <TypeIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={isCompleted ? "success" : isDismissed ? "secondary" : priorityToBadge[action.priority] || "low"}>
                        {isCompleted ? "Completada" : isDismissed ? "Descartada" : action.priority}
                      </Badge>
                      <Badge variant="outline">
                        {typeConf.label}
                      </Badge>
                      {action.contact_name && (
                        <span className="text-xs text-[var(--muted-foreground)]">{action.contact_name}</span>
                      )}
                      {isOverdue && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                          <Flame className="h-3 w-3" />
                          VENCIDA
                        </span>
                      )}
                    </div>

                    <p className={cn("text-sm", isCompleted && "line-through opacity-70")}>{action.description}</p>

                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                      <span>{timeAgo(action.created_at)}</span>
                      {action.due_date && !isCompleted && (
                        <span className={cn(
                          "flex items-center gap-1",
                          isOverdue ? "text-[var(--destructive)] font-bold" :
                          daysLeft !== null && daysLeft <= 1 ? "text-[var(--warning)]" : "",
                        )}>
                          <Clock className="h-3 w-3" />
                          {isOverdue
                            ? `Vencida hace ${Math.abs(daysLeft!)} dia${Math.abs(daysLeft!) !== 1 ? "s" : ""}`
                            : daysLeft === 0 ? "Vence hoy"
                            : daysLeft === 1 ? "Vence manana"
                            : `Vence en ${daysLeft} dias`
                          }
                        </span>
                      )}
                      {action.assignee_email && (
                        <span className="hidden sm:inline">Asignado: {action.assignee_email}</span>
                      )}
                      {action.completed_date && (
                        <span className="text-[var(--success)]">
                          Completada {timeAgo(action.completed_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {action.state === "pending" && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={() => completeAction(action.id)} title="Completar" className="h-8 w-8 hover:text-[var(--success)]">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => dismissAction(action.id)} title="Descartar" className="h-8 w-8">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
