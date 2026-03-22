"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Shield,
  Crosshair,
  Activity,
  Flame,
  ExternalLink,
  Zap,
  User,
  Mail,
  Clock,
  X,
} from "lucide-react";

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  contact_name: string;
  related_contact: string;
  account: string;
  state: string;
  is_read: boolean;
  created_at: string;
  resolved_at: string | null;
  related_thread_id: string | null;
  related_email_id: string | null;
  business_impact: string | null;
  suggested_action: string | null;
  user_feedback?: string | null;
  feedback_comment?: string | null;
}

// Extended type labels matching alert_type_catalog in Supabase
const typeLabel: Record<string, string> = {
  stalled_thread: "Thread sin respuesta",
  no_response: "Email sin respuesta",
  high_volume: "Volumen alto",
  competitor: "Competidor",
  negative_sentiment: "Sentimiento negativo",
  churn_risk: "Riesgo de perdida",
  invoice_silence: "Silencio en cobro",
  anomaly: "Anomalia",
  accountability: "Accion pendiente",
  quality_issue: "Problema de calidad",
  payment_delay: "Retraso de pago",
  delivery_risk: "Riesgo de entrega",
  opportunity: "Oportunidad",
  cross_department: "Cross-departamento",
  purchase_cycle_break: "Quiebre ciclo compra",
  sla_breach: "SLA incumplido",
  commitment_breach: "Promesa incumplida",
  sentiment: "Sentimiento",
  risk: "Riesgo",
  communication_gap: "Comunicacion",
};

const categoryLabel: Record<string, string> = {
  commercial: "Comercial",
  financial: "Financiero",
  operational: "Operativo",
  quality: "Calidad",
  relationship: "Relacion",
  opportunity: "Oportunidad",
};

const severityToBadge: Record<string, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

type FeedbackType = "helpful" | "partially_helpful" | "not_helpful";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("new");
  const [counts, setCounts] = useState({ new: 0, acknowledged: 0, resolved: 0, all: 0 });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackType | null>(null);
  const [feedbackComment, setFeedbackComment] = useState<string>("");

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  useEffect(() => {
    async function fetchAlerts() {
      let query = supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (stateFilter !== "all") {
        query = query.eq("state", stateFilter);
      }

      const { data } = await query;
      setAlerts(data || []);
      setLoading(false);
    }

    async function fetchCounts() {
      const [newRes, ackRes, resRes, allRes] = await Promise.all([
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "acknowledged"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
        supabase.from("alerts").select("id", { count: "exact", head: true }),
      ]);
      setCounts({
        new: newRes.count ?? 0,
        acknowledged: ackRes.count ?? 0,
        resolved: resRes.count ?? 0,
        all: allRes.count ?? 0,
      });
    }

    fetchAlerts();
    fetchCounts();
  }, [stateFilter]);

  async function markRead(id: string) {
    await supabase.from("alerts").update({ is_read: true, state: "acknowledged" }).eq("id", id);
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_read: true, state: "acknowledged" } : a))
    );
    setCounts((c) => ({ ...c, new: Math.max(0, c.new - 1), acknowledged: c.acknowledged + 1 }));
  }

  function startResolving(id: string) {
    setResolvingAlertId(id);
    setSelectedFeedback(null);
    setFeedbackComment("");
  }

  function cancelResolving() {
    setResolvingAlertId(null);
    setSelectedFeedback(null);
    setFeedbackComment("");
  }

  async function confirmResolve() {
    if (!resolvingAlertId || !selectedFeedback) return;

    const now = new Date().toISOString();
    const updateData: Record<string, any> = {
      state: "resolved",
      resolved_at: now,
      user_feedback: selectedFeedback,
    };

    if (feedbackComment.trim()) {
      updateData.feedback_comment = feedbackComment;
    }

    await supabase.from("alerts").update(updateData).eq("id", resolvingAlertId);

    setAlerts((prev) =>
      prev.map((a) =>
        a.id === resolvingAlertId
          ? {
              ...a,
              state: "resolved",
              resolved_at: now,
              user_feedback: selectedFeedback,
              feedback_comment: feedbackComment.trim() || null,
            }
          : a
      )
    );

    setCounts((c) => {
      const wasNew = alerts.find((a) => a.id === resolvingAlertId)?.state === "new";
      return {
        ...c,
        new: wasNew ? Math.max(0, c.new - 1) : c.new,
        acknowledged: wasNew ? c.acknowledged : Math.max(0, c.acknowledged - 1),
        resolved: c.resolved + 1,
      };
    });

    cancelResolving();
  }

  const severityCounts = {
    critical: alerts.filter((a) => a.severity === "critical").length,
    high: alerts.filter((a) => a.severity === "high").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
    low: alerts.filter((a) => a.severity === "low").length,
  };

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  const stateFilters = [
    { key: "new", label: "Nuevas", count: counts.new },
    { key: "acknowledged", label: "Vistas", count: counts.acknowledged },
    { key: "resolved", label: "Resueltas", count: counts.resolved },
    { key: "all", label: "Todas", count: counts.all },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 text-[var(--warning)]" />
            <h1 className="text-2xl font-black tracking-tight">Radar de Amenazas</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Alertas de inteligencia sobre clientes y operaciones
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Severity distribution */}
          <div className="hidden md:flex items-center gap-3">
            {severityCounts.critical > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--severity-critical)]">
                <span className="severity-dot animate-pulse" data-severity="critical" />
                {severityCounts.critical} criticas
              </span>
            )}
            {severityCounts.high > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--severity-high)]">
                <span className="severity-dot" data-severity="high" />
                {severityCounts.high} altas
              </span>
            )}
            {severityCounts.medium > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--severity-medium)]">
                <span className="severity-dot" data-severity="medium" />
                {severityCounts.medium} medias
              </span>
            )}
            {severityCounts.low > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--severity-low)]">
                <span className="severity-dot" data-severity="low" />
                {severityCounts.low} bajas
              </span>
            )}
          </div>

          {/* Unread count */}
          {unreadCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-[var(--destructive)]">
              <Flame className="h-4 w-4" />
              <span className="font-bold">{unreadCount} sin leer</span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
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

      {/* Alert List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-[var(--warning)] animate-pulse" />
        </div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 mb-3 text-[var(--success)] opacity-40" />
            <p className="text-sm font-medium">Perimetro seguro</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              No hay alertas en esta categoria
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const isNew = alert.state === "new" && !alert.is_read;
            const severityVar = `var(--severity-${alert.severity || "low"})`;
            const severityMutedVar = `var(--severity-${alert.severity || "low"}-muted)`;
            const isExpanded = expandedIds.has(alert.id);

            return (
              <Card
                key={alert.id}
                className={cn("transition-all", isNew && "border-l-3")}
                style={
                  isNew
                    ? {
                        borderLeftColor: severityVar,
                        backgroundColor: severityMutedVar,
                      }
                    : undefined
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Severity icon */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: severityMutedVar }}
                    >
                      <AlertTriangle className="h-5 w-5" style={{ color: severityVar }} />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Badges row */}
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <Badge variant={severityToBadge[alert.severity] || "low"}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="outline">
                          {typeLabel[alert.alert_type] || alert.alert_type}
                        </Badge>
                        {isNew && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
                            NUEVA
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <p className="text-sm font-bold leading-snug">{alert.title}</p>

                      {/* Description — show 4+ lines, no truncation */}
                      {alert.description && (
                        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
                          {alert.description}
                        </p>
                      )}

                      {/* Impacto & Accion sugerida */}
                      <div className="mt-3 space-y-2">
                        {alert.business_impact && (
                          <div className="flex items-start gap-2 rounded-md p-2"
                            style={{ backgroundColor: severityMutedVar }}
                          >
                            <Zap
                              className="h-4 w-4 mt-0.5 shrink-0"
                              style={{ color: severityVar }}
                            />
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                                Impacto
                              </span>
                              <p className="text-sm font-medium">{alert.business_impact}</p>
                            </div>
                          </div>
                        )}

                        {alert.suggested_action && (
                          <div className="flex items-start gap-2 rounded-md p-2 bg-[var(--accent)]">
                            <Crosshair className="h-4 w-4 mt-0.5 shrink-0 text-[var(--primary)]" />
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                                Accion sugerida
                              </span>
                              <p className="text-sm font-medium">{alert.suggested_action}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Meta row: contact, account, time */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                        {alert.contact_name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {alert.contact_name}
                          </span>
                        )}
                        {alert.account && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {alert.account}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(alert.created_at)}
                        </span>
                        {alert.resolved_at && (
                          <span className="flex items-center gap-1 text-[var(--success)]">
                            <Check className="h-3 w-3" />
                            Resuelta {timeAgo(alert.resolved_at)}
                          </span>
                        )}
                      </div>

                      {/* Expandable detail */}
                      {alert.related_thread_id && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleExpand(alert.id)}
                            className={cn(
                              "flex items-center gap-1 text-xs font-medium transition-colors",
                              "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            )}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                            {isExpanded ? "Ocultar contexto" : "Ver contexto"}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 rounded-md border border-[var(--border)] p-3 bg-[var(--muted)]">
                              <p className="text-xs text-[var(--muted-foreground)] mb-2">
                                Thread de origen vinculado a esta alerta.
                              </p>
                              <a
                                href={`/emails?thread=${alert.related_thread_id}`}
                                className="inline-flex items-center gap-1.5"
                              >
                                <Button variant="outline" size="sm">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Abrir thread
                                </Button>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    {resolvingAlertId === alert.id ? (
                      <div className="flex shrink-0 flex-col gap-3 min-w-64 animate-in fade-in duration-200">
                        {/* Feedback options */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedFeedback("helpful")}
                            className={cn(
                              "px-2.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                              selectedFeedback === "helpful"
                                ? "bg-[var(--success)] text-white shadow-md"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            )}
                          >
                            Útil
                          </button>
                          <button
                            onClick={() => setSelectedFeedback("partially_helpful")}
                            className={cn(
                              "px-2.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                              selectedFeedback === "partially_helpful"
                                ? "bg-[var(--warning)] text-white shadow-md"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            )}
                          >
                            Parcialmente
                          </button>
                          <button
                            onClick={() => setSelectedFeedback("not_helpful")}
                            className={cn(
                              "px-2.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                              selectedFeedback === "not_helpful"
                                ? "bg-[var(--destructive)] text-white shadow-md"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            )}
                          >
                            No ayudó
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={cancelResolving}
                            title="Cancelar"
                            className="h-7 w-7 ml-auto hover:text-[var(--destructive)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {/* Comment input */}
                        <input
                          type="text"
                          placeholder="Comentario opcional..."
                          value={feedbackComment}
                          onChange={(e) => setFeedbackComment(e.target.value)}
                          className="text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-white placeholder-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />

                        {/* Confirm button */}
                        <Button
                          size="sm"
                          onClick={confirmResolve}
                          disabled={!selectedFeedback}
                          className="w-full text-xs"
                          variant={selectedFeedback ? "default" : "outline"}
                        >
                          Confirmar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 gap-1">
                        {alert.state === "new" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => markRead(alert.id)}
                            title="Marcar como vista"
                            className="h-8 w-8"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {alert.state !== "resolved" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startResolving(alert.id)}
                            title="Resolver"
                            className="h-8 w-8 hover:text-[var(--success)]"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
