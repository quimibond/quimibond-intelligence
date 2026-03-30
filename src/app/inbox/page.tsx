"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  CheckSquare,
  Clock,
  DollarSign,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  User,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeAgo, sentimentColor } from "@/lib/utils";
import type { Alert, ActionItem } from "@/lib/types";
import { DataFreshness } from "@/components/shared/data-freshness";
import { PageHeader } from "@/components/shared/page-header";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──

interface DecisionItem {
  type: "alert" | "action";
  id: number;
  title: string;
  description: string | null;
  severity: string;
  priority: string;
  state: string;
  impactScore: number;
  valueAtRisk: number | null;
  contactName: string | null;
  contactId: number | null;
  companyId: number | null;
  companyName: string | null;
  suggestedAction: string | null;
  threadId: number | null;
  dueDate: string | null;
  assignee: string | null;
  createdAt: string;
  daysOld: number;
}

interface InboxStats {
  criticalAlerts: number;
  overdueActions: number;
  totalValueAtRisk: number;
  stalledThreads: number;
}

// ── Scoring ──

function computeImpactScore(item: {
  severity?: string;
  priority?: string;
  valueAtRisk?: number | null;
  daysOld: number;
}): number {
  const severityWeight: Record<string, number> = {
    critical: 100, high: 70, medium: 40, low: 15,
  };
  const priorityWeight: Record<string, number> = {
    high: 80, medium: 50, low: 20,
  };
  let score = severityWeight[item.severity ?? ""] ?? 30;
  score += priorityWeight[item.priority ?? ""] ?? 30;
  if (item.valueAtRisk && item.valueAtRisk > 0) {
    score += Math.min(50, Math.log10(item.valueAtRisk) * 10);
  }
  score += Math.min(30, item.daysOld * 3);
  return Math.round(score);
}

// ── Page ──

export default function InboxPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [creatingAction, setCreatingAction] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split("T")[0];

      const [alertsRes, actionsRes, stalledRes] = await Promise.all([
        supabase
          .from("alerts")
          .select("*")
          .in("state", ["new", "acknowledged"])
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("action_items")
          .select("*")
          .eq("state", "pending")
          .order("due_date", { ascending: true })
          .limit(50),
        supabase
          .from("threads")
          .select("id", { count: "exact", head: true })
          .in("status", ["stalled", "needs_response"]),
      ]);

      const alerts = (alertsRes.data ?? []) as Alert[];
      const actions = (actionsRes.data ?? []) as ActionItem[];
      const now = Date.now();

      const decisionItems: DecisionItem[] = [];

      for (const a of alerts) {
        const daysOld = Math.floor((now - new Date(a.created_at).getTime()) / 86400000);
        const item: DecisionItem = {
          type: "alert",
          id: a.id,
          title: a.title,
          description: a.description,
          severity: a.severity,
          priority: a.severity === "critical" ? "high" : a.severity === "high" ? "high" : "medium",
          state: a.state,
          impactScore: 0,
          valueAtRisk: a.business_value_at_risk,
          contactName: a.contact_name,
          contactId: a.contact_id,
          companyId: a.company_id,
          companyName: null,
          suggestedAction: a.suggested_action,
          threadId: a.thread_id,
          dueDate: null,
          assignee: null,
          createdAt: a.created_at,
          daysOld,
        };
        item.impactScore = computeImpactScore(item);
        decisionItems.push(item);
      }

      for (const a of actions) {
        const daysOld = Math.floor((now - new Date(a.created_at).getTime()) / 86400000);
        const isOverdue = a.due_date && a.due_date < today;
        const item: DecisionItem = {
          type: "action",
          id: a.id,
          title: a.description,
          description: a.reason,
          severity: isOverdue ? "high" : "medium",
          priority: a.priority,
          state: a.state,
          impactScore: 0,
          valueAtRisk: null,
          contactName: a.contact_name,
          contactId: a.contact_id,
          companyId: a.company_id,
          companyName: a.contact_company,
          suggestedAction: null,
          threadId: a.thread_id,
          dueDate: a.due_date,
          assignee: a.assignee_name ?? a.assignee_email,
          createdAt: a.created_at,
          daysOld,
        };
        item.impactScore = computeImpactScore(item);
        decisionItems.push(item);
      }

      // Sort by impact score descending
      decisionItems.sort((a, b) => b.impactScore - a.impactScore);

      const totalValueAtRisk = alerts.reduce(
        (s, a) => s + (a.business_value_at_risk ?? 0), 0
      );

      setItems(decisionItems);
      setStats({
        criticalAlerts: alerts.filter(a => a.severity === "critical" || a.severity === "high").length,
        overdueActions: actions.filter(a => a.due_date && a.due_date < today).length,
        totalValueAtRisk,
        stalledThreads: stalledRes.count ?? 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  // ── Create action from alert ──
  const createActionFromAlert = useCallback(async (item: DecisionItem) => {
    if (item.type !== "alert") return;
    setCreatingAction(item.id);
    try {
      const { error } = await supabase.from("action_items").insert({
        action_type: "follow_up",
        description: item.suggestedAction ?? `Dar seguimiento: ${item.title}`,
        reason: item.title,
        priority: item.severity === "critical" ? "high" : item.severity === "high" ? "high" : "medium",
        contact_id: item.contactId,
        contact_name: item.contactName,
        company_id: item.companyId,
        contact_company: item.companyName,
        thread_id: item.threadId,
        alert_id: item.id,
        state: "pending",
        due_date: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0],
      });
      if (error) throw error;
      toast.success("Accion creada", {
        description: item.suggestedAction ?? item.title,
      });
      // Mark alert as acknowledged
      await supabase.from("alerts").update({ state: "acknowledged" }).eq("id", item.id);
      setItems(prev => prev.map(i =>
        i.type === "alert" && i.id === item.id ? { ...i, state: "acknowledged" } : i
      ));
    } catch (err) {
      toast.error("Error al crear accion");
      console.error(err);
    } finally {
      setCreatingAction(null);
    }
  }, []);

  // ── Dismiss ──
  const dismiss = useCallback(async (item: DecisionItem) => {
    const table = item.type === "alert" ? "alerts" : "action_items";
    const newState = item.type === "alert" ? "dismissed" : "dismissed";
    await supabase.from(table).update({ state: newState }).eq("id", item.id);
    setItems(prev => prev.filter(i => !(i.type === item.type && i.id === item.id)));
    toast("Descartado", { description: item.title });
  }, []);

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  const topItems = items.slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Inbox de Decisiones"
          description="Lo que necesita tu atencion ahora, ordenado por impacto"
        />
        <DataFreshness />
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className={stats.criticalAlerts > 0 ? "border-red-500/30 bg-red-500/5" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Bell className="h-3.5 w-3.5 text-red-500" />
                Alertas Criticas
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                {stats.criticalAlerts}
              </p>
            </CardContent>
          </Card>
          <Card className={stats.overdueActions > 0 ? "border-amber-500/30 bg-amber-500/5" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                Acciones Vencidas
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {stats.overdueActions}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5 text-red-500" />
                Valor en Riesgo
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {formatCurrency(stats.totalValueAtRisk)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5 text-amber-500" />
                Hilos Sin Respuesta
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {stats.stalledThreads}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Decision Items */}
      {topItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
            <h3 className="text-lg font-semibold">Todo al dia</h3>
            <p className="text-sm text-muted-foreground mt-1">No hay decisiones pendientes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {topItems.map((item) => (
            <Card
              key={`${item.type}-${item.id}`}
              className={cn(
                "transition-all hover:border-primary/20",
                item.state === "acknowledged" && "opacity-60",
              )}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  {/* Impact score */}
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                    item.impactScore >= 150 ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                    item.impactScore >= 100 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {item.impactScore}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={item.type === "alert" ? "warning" : "info"} className="text-[10px]">
                            {item.type === "alert" ? "Alerta" : "Accion"}
                          </Badge>
                          <SeverityBadge severity={item.severity} />
                          {item.valueAtRisk != null && item.valueAtRisk > 0 && (
                            <Badge variant="critical" className="gap-1 text-[10px]">
                              <DollarSign className="h-3 w-3" />
                              {formatCurrency(item.valueAtRisk)}
                            </Badge>
                          )}
                          {item.dueDate && item.dueDate < new Date().toISOString().split("T")[0] && (
                            <Badge variant="critical" className="text-[10px]">VENCIDA</Badge>
                          )}
                        </div>
                        <h3 className="mt-1 text-sm font-medium leading-snug">{item.title}</h3>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(item.createdAt)}
                      </span>
                    </div>

                    {/* Context row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {item.contactName && (
                        <Link
                          href={item.contactId ? `/contacts/${item.contactId}` : "#"}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <User className="h-3 w-3" />
                          {item.contactName}
                        </Link>
                      )}
                      {item.companyId && (
                        <Link
                          href={`/companies/${item.companyId}`}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          {item.companyName ?? `Empresa #${item.companyId}`}
                        </Link>
                      )}
                      {item.assignee && (
                        <span className="flex items-center gap-1">
                          <CheckSquare className="h-3 w-3" />
                          {item.assignee}
                        </span>
                      )}
                      {item.dueDate && (
                        <span>{item.dueDate}</span>
                      )}
                    </div>

                    {/* Suggested action */}
                    {item.suggestedAction && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                        <span className="font-medium text-foreground">Sugerencia IA: </span>
                        {item.suggestedAction}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {item.type === "alert" && item.state === "new" && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 gap-1 text-xs"
                          disabled={creatingAction === item.id}
                          onClick={() => createActionFromAlert(item)}
                        >
                          {creatingAction === item.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          Crear Accion
                        </Button>
                      )}
                      {item.type === "alert" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => router.push(`/alerts/${item.id}`)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ver Detalle
                        </Button>
                      )}
                      {item.threadId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs"
                          onClick={() => router.push(`/threads/${item.threadId}`)}
                        >
                          <MessageSquare className="h-3 w-3" />
                          Ver Hilo
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={() => dismiss(item)}
                      >
                        <XCircle className="h-3 w-3" />
                        Descartar
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {items.length > 20 && (
            <div className="text-center">
              <Button variant="outline" onClick={() => router.push("/alerts")}>
                Ver todas las alertas ({items.filter(i => i.type === "alert").length})
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
