"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  ExternalLink,
  Lightbulb,
  Loader2,
  Mail,
  PartyPopper,
  Plus,
  RefreshCw,
  User,
  X,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import type { Alert, ActionItem } from "@/lib/types";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Types ──

interface DecisionItem {
  type: "alert" | "action" | "insight";
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
  // Insight-specific
  insightType: string | null;
  category: string | null;
  recommendation: string | null;
  confidence: number | null;
}

interface InboxStats {
  criticalAlerts: number;
  overdueActions: number;
  totalValueAtRisk: number;
  stalledThreads: number;
  insightCount: number;
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

// ── Impact badge color ──

function impactColor(score: number): string {
  if (score >= 180) return "bg-red-500 text-white";
  if (score >= 150) return "bg-red-500/80 text-white";
  if (score >= 120) return "bg-orange-500 text-white";
  if (score >= 90) return "bg-amber-500 text-white";
  if (score >= 60) return "bg-blue-500 text-white";
  return "bg-muted text-muted-foreground";
}

// ── Type badge config ──

function typeBadgeConfig(type: "alert" | "action" | "insight"): {
  label: string;
  variant: "warning" | "info" | "success";
  Icon: React.ElementType;
} {
  switch (type) {
    case "alert":
      return { label: "Alerta", variant: "warning", Icon: AlertTriangle };
    case "action":
      return { label: "Accion", variant: "info", Icon: Zap };
    case "insight":
      return { label: "Insight", variant: "success", Icon: Lightbulb };
  }
}

// ── Swipe threshold ──
const SWIPE_THRESHOLD = 100;
const SWIPE_DISMISS_PX = 300;

// ── Page ──

export default function InboxPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [creatingAction, setCreatingAction] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDescription, setExpandedDescription] = useState(false);

  // Swipe state
  const [swipeDeltaX, setSwipeDeltaX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];

    const [alertsRes, actionsRes, stalledRes, insightsRes] = await Promise.all([
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
      supabase
        .from("agent_insights")
        .select("id, agent_id, insight_type, category, severity, title, description, recommendation, confidence, business_impact_estimate, state, contact_id, company_id, created_at")
        .eq("state", "new")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const alerts = (alertsRes.data ?? []) as Alert[];
    const actions = (actionsRes.data ?? []) as ActionItem[];
    const insights = (insightsRes.data ?? []) as Array<{
      id: number;
      agent_id: number | null;
      insight_type: string;
      category: string | null;
      severity: string;
      title: string;
      description: string | null;
      recommendation: string | null;
      confidence: number | null;
      business_impact_estimate: number | null;
      state: string;
      contact_id: number | null;
      company_id: number | null;
      created_at: string;
    }>;
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
        insightType: null,
        category: null,
        recommendation: null,
        confidence: null,
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
        insightType: null,
        category: null,
        recommendation: null,
        confidence: null,
      };
      item.impactScore = computeImpactScore(item);
      decisionItems.push(item);
    }

    for (const ins of insights) {
      const daysOld = Math.floor((now - new Date(ins.created_at).getTime()) / 86400000);
      const item: DecisionItem = {
        type: "insight",
        id: ins.id,
        title: ins.title,
        description: ins.description,
        severity: ins.severity ?? "medium",
        priority: ins.severity === "critical" ? "high" : ins.severity === "high" ? "high" : "medium",
        state: ins.state,
        impactScore: 0,
        valueAtRisk: ins.business_impact_estimate,
        contactName: null,
        contactId: ins.contact_id,
        companyId: ins.company_id,
        companyName: null,
        suggestedAction: ins.recommendation,
        threadId: null,
        dueDate: null,
        assignee: null,
        createdAt: ins.created_at,
        daysOld,
        insightType: ins.insight_type,
        category: ins.category,
        recommendation: ins.recommendation,
        confidence: ins.confidence,
      };
      item.impactScore = computeImpactScore(item);
      decisionItems.push(item);
    }

    decisionItems.sort((a, b) => b.impactScore - a.impactScore);

    const totalValueAtRisk = alerts.reduce(
      (s, a) => s + (a.business_value_at_risk ?? 0), 0
    );

    setItems(decisionItems);
    setCurrentIndex(0);
    setExpandedDescription(false);
    setStats({
      criticalAlerts: alerts.filter(a => a.severity === "critical" || a.severity === "high").length,
      overdueActions: actions.filter(a => a.due_date && a.due_date < today).length,
      totalValueAtRisk,
      stalledThreads: stalledRes.count ?? 0,
      insightCount: insights.length,
    });
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Refresh ──
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success("Inbox actualizado");
  }, [loadData]);

  // ── Remove current card and advance ──
  const removeCurrentCard = useCallback((direction: "left" | "right") => {
    setExitDirection(direction);
    setTimeout(() => {
      setItems(prev => {
        const newItems = [...prev];
        newItems.splice(currentIndex, 1);
        return newItems;
      });
      setExitDirection(null);
      setSwipeDeltaX(0);
      setExpandedDescription(false);
      // currentIndex stays the same (next card slides in), unless we're at the end
      setCurrentIndex(prev => prev >= items.length - 1 ? Math.max(0, prev - 1) : prev);
    }, 300);
  }, [currentIndex, items.length]);

  // ── Create action from alert ──
  const createActionFromAlert = useCallback(async (item: DecisionItem) => {
    if (item.type === "insight") {
      // Mark insight as acted on
      setCreatingAction(item.id);
      try {
        await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", item.id);
        toast.success("Insight marcado como util", { description: item.title });
        removeCurrentCard("right");
      } catch {
        toast.error("Error al actualizar insight");
      } finally {
        setCreatingAction(null);
      }
      return;
    }

    if (item.type === "action") {
      // Mark action as completed
      setCreatingAction(item.id);
      try {
        await supabase.from("action_items").update({ state: "done" }).eq("id", item.id);
        toast.success("Accion completada", { description: item.title });
        removeCurrentCard("right");
      } catch {
        toast.error("Error al completar accion");
      } finally {
        setCreatingAction(null);
      }
      return;
    }

    // Alert: create action
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
      await supabase.from("alerts").update({ state: "acknowledged" }).eq("id", item.id);
      removeCurrentCard("right");
    } catch (err) {
      toast.error("Error al crear accion");
      console.error(err);
    } finally {
      setCreatingAction(null);
    }
  }, [removeCurrentCard]);

  // ── Dismiss ──
  const dismiss = useCallback(async (item: DecisionItem) => {
    if (item.type === "alert") {
      await supabase.from("alerts").update({ state: "dismissed" }).eq("id", item.id);
    } else if (item.type === "action") {
      await supabase.from("action_items").update({ state: "dismissed" }).eq("id", item.id);
    } else {
      await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", item.id);
    }
    toast("Descartado", { description: item.title });
    removeCurrentCard("left");
  }, [removeCurrentCard]);

  // ── Navigate to detail ──
  const goToDetail = useCallback((item: DecisionItem) => {
    if (item.type === "alert") {
      router.push(`/alerts/${item.id}`);
    } else if (item.type === "action") {
      router.push(`/actions`);
    } else if (item.contactId) {
      router.push(`/contacts/${item.contactId}`);
    } else if (item.companyId) {
      router.push(`/companies/${item.companyId}`);
    }
  }, [router]);

  // ── Touch handlers ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
    isHorizontalSwipeRef.current = null;
    setIsSwiping(false);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    // Determine swipe direction on first significant movement
    if (isHorizontalSwipeRef.current === null) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        isHorizontalSwipeRef.current = Math.abs(deltaX) > Math.abs(deltaY);
      }
    }

    if (isHorizontalSwipeRef.current) {
      e.preventDefault();
      setIsSwiping(true);
      setSwipeDeltaX(deltaX);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current || !isSwiping) {
      touchStartRef.current = null;
      return;
    }

    const currentItem = items[currentIndex];
    if (!currentItem) {
      touchStartRef.current = null;
      setSwipeDeltaX(0);
      setIsSwiping(false);
      return;
    }

    if (swipeDeltaX > SWIPE_THRESHOLD) {
      // Swipe right → act
      createActionFromAlert(currentItem);
    } else if (swipeDeltaX < -SWIPE_THRESHOLD) {
      // Swipe left → dismiss
      dismiss(currentItem);
    } else {
      // Snap back
      setSwipeDeltaX(0);
    }

    touchStartRef.current = null;
    setIsSwiping(false);
  }, [isSwiping, swipeDeltaX, items, currentIndex, createActionFromAlert, dismiss]);

  // ── Mouse swipe for desktop ──
  const mouseDownRef = useRef<{ x: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = { x: e.clientX };
    setIsSwiping(false);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseDownRef.current) return;
    const deltaX = e.clientX - mouseDownRef.current.x;
    if (Math.abs(deltaX) > 5) {
      setIsSwiping(true);
      setSwipeDeltaX(deltaX);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!mouseDownRef.current) return;
    const currentItem = items[currentIndex];

    if (currentItem && isSwiping) {
      if (swipeDeltaX > SWIPE_THRESHOLD) {
        createActionFromAlert(currentItem);
      } else if (swipeDeltaX < -SWIPE_THRESHOLD) {
        dismiss(currentItem);
      } else {
        setSwipeDeltaX(0);
      }
    } else {
      setSwipeDeltaX(0);
    }

    mouseDownRef.current = null;
    setIsSwiping(false);
  }, [items, currentIndex, isSwiping, swipeDeltaX, createActionFromAlert, dismiss]);

  const handleMouseLeave = useCallback(() => {
    if (mouseDownRef.current) {
      setSwipeDeltaX(0);
      mouseDownRef.current = null;
      setIsSwiping(false);
    }
  }, []);

  // ── Current item ──
  const currentItem = items[currentIndex] ?? null;
  const nextItem = items[currentIndex + 1] ?? null;
  const thirdItem = items[currentIndex + 2] ?? null;

  // Swipe visual indicators
  const swipeOpacity = Math.min(1, Math.abs(swipeDeltaX) / SWIPE_THRESHOLD);
  const isSwipingRight = swipeDeltaX > 30;
  const isSwipingLeft = swipeDeltaX < -30;

  // Card transform
  const cardStyle = exitDirection
    ? {
        transform: `translateX(${exitDirection === "right" ? SWIPE_DISMISS_PX : -SWIPE_DISMISS_PX}px) rotate(${exitDirection === "right" ? 15 : -15}deg)`,
        opacity: 0,
        transition: "transform 0.3s ease-out, opacity 0.3s ease-out",
      }
    : {
        transform: isSwiping || swipeDeltaX !== 0
          ? `translateX(${swipeDeltaX}px) rotate(${swipeDeltaX * 0.05}deg)`
          : "translateX(0) rotate(0deg)",
        transition: isSwiping ? "none" : "transform 0.3s ease-out",
      };

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="flex flex-col items-center px-4 py-6">
        <div className="w-full max-w-lg space-y-4">
          <div className="h-10 rounded-lg bg-muted animate-pulse" />
          <div className="h-[500px] rounded-2xl bg-muted animate-pulse" />
          <div className="flex justify-center gap-6">
            <div className="h-14 w-14 rounded-full bg-muted animate-pulse" />
            <div className="h-14 w-14 rounded-full bg-muted animate-pulse" />
            <div className="h-14 w-14 rounded-full bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 py-4 min-h-[calc(100vh-4rem)] select-none">
      <div className="w-full max-w-lg space-y-4">

        {/* ── Stats bar ── */}
        {stats && (
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-2.5 text-xs overflow-x-auto">
            <div className="flex items-center gap-1.5 shrink-0">
              <Bell className="h-3.5 w-3.5 text-red-500" />
              <span className="font-semibold text-red-600 dark:text-red-400">{stats.criticalAlerts}</span>
              <span className="text-muted-foreground">criticas</span>
            </div>
            <div className="h-3 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-semibold text-amber-600 dark:text-amber-400">{stats.overdueActions}</span>
              <span className="text-muted-foreground">vencidas</span>
            </div>
            <div className="h-3 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <DollarSign className="h-3.5 w-3.5 text-red-500" />
              <span className="font-semibold">{formatCurrency(stats.totalValueAtRisk)}</span>
            </div>
            <div className="h-3 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <Mail className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-semibold">{stats.stalledThreads}</span>
              <span className="text-muted-foreground">hilos</span>
            </div>
            {stats.insightCount > 0 && (
              <>
                <div className="h-3 w-px bg-border shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Brain className="h-3.5 w-3.5 text-purple-500" />
                  <span className="font-semibold text-purple-600 dark:text-purple-400">{stats.insightCount}</span>
                  <span className="text-muted-foreground">insights</span>
                </div>
              </>
            )}
            <div className="ml-auto shrink-0">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="rounded-full p-1 hover:bg-muted transition-colors"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", refreshing && "animate-spin")} />
              </button>
            </div>
          </div>
        )}

        {/* ── Card counter ── */}
        {items.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{currentIndex + 1} de {items.length} pendientes</span>
            <div className="flex gap-1">
              {items.slice(currentIndex, currentIndex + 5).map((it, i) => (
                <div
                  key={`${it.type}-${it.id}`}
                  className={cn(
                    "h-1.5 w-6 rounded-full transition-all",
                    i === 0 ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                />
              ))}
              {items.length - currentIndex > 5 && (
                <span className="text-[10px] ml-1">+{items.length - currentIndex - 5}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Card stack area ── */}
        {items.length === 0 ? (
          /* ── Empty state: celebration ── */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative mb-6">
              <div className="absolute -inset-4 rounded-full bg-emerald-500/10 animate-ping" />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/15">
                <PartyPopper className="h-12 w-12 text-emerald-500" />
              </div>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Todo al dia!</h2>
            <p className="mt-2 text-muted-foreground max-w-xs">
              No hay decisiones pendientes. Tu inbox esta limpio.
            </p>
            <Button
              variant="outline"
              className="mt-6 gap-2"
              onClick={handleRefresh}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              Revisar de nuevo
            </Button>
          </div>
        ) : (
          <>
            {/* ── Card stack ── */}
            <div
              className="relative"
              style={{ height: "min(520px, 60vh)", touchAction: "pan-y" }}
            >
              {/* Third card (deepest) */}
              {thirdItem && (
                <div
                  className="absolute inset-x-0 top-0 h-full rounded-2xl border bg-card shadow-sm"
                  style={{
                    transform: "scale(0.92) translateY(16px)",
                    opacity: 0.4,
                    zIndex: 1,
                  }}
                />
              )}

              {/* Second card (behind) */}
              {nextItem && (
                <div
                  className="absolute inset-x-0 top-0 h-full rounded-2xl border bg-card shadow-md"
                  style={{
                    transform: "scale(0.96) translateY(8px)",
                    opacity: 0.7,
                    zIndex: 2,
                  }}
                />
              )}

              {/* Current card (front) */}
              {currentItem && (
                <div
                  className={cn(
                    "absolute inset-x-0 top-0 h-full rounded-2xl border bg-card shadow-lg overflow-hidden cursor-grab active:cursor-grabbing",
                    isSwipingRight && "ring-2 ring-emerald-500/50",
                    isSwipingLeft && "ring-2 ring-red-500/50",
                  )}
                  style={{ ...cardStyle, zIndex: 3 }}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Swipe indicators overlayed */}
                  {isSwipingRight && (
                    <div
                      className="absolute inset-0 bg-emerald-500/10 z-10 pointer-events-none flex items-center justify-start pl-6"
                      style={{ opacity: swipeOpacity }}
                    >
                      <div className="flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-white font-semibold text-sm shadow-lg">
                        <Check className="h-5 w-5" />
                        Actuar
                      </div>
                    </div>
                  )}
                  {isSwipingLeft && (
                    <div
                      className="absolute inset-0 bg-red-500/10 z-10 pointer-events-none flex items-center justify-end pr-6"
                      style={{ opacity: swipeOpacity }}
                    >
                      <div className="flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-white font-semibold text-sm shadow-lg">
                        Descartar
                        <X className="h-5 w-5" />
                      </div>
                    </div>
                  )}

                  {/* Card content */}
                  <div className="flex flex-col h-full p-5 overflow-y-auto">
                    {/* Top row: type badge + impact score + time */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const cfg = typeBadgeConfig(currentItem.type);
                          return (
                            <Badge variant={cfg.variant} className="gap-1 text-[11px]">
                              <cfg.Icon className="h-3 w-3" />
                              {cfg.label}
                            </Badge>
                          );
                        })()}
                        <SeverityBadge severity={currentItem.severity} />
                        {currentItem.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {currentItem.category}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                          impactColor(currentItem.impactScore)
                        )}>
                          {currentItem.impactScore}
                        </div>
                      </div>
                    </div>

                    {/* Title */}
                    <h2 className="text-lg font-semibold leading-snug mb-2">
                      {currentItem.title}
                    </h2>

                    {/* Time and value badges */}
                    <div className="flex items-center gap-3 flex-wrap mb-3">
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(currentItem.createdAt)}
                      </span>
                      {currentItem.valueAtRisk != null && currentItem.valueAtRisk > 0 && (
                        <Badge variant="critical" className="gap-1 text-[10px]">
                          <DollarSign className="h-3 w-3" />
                          {formatCurrency(currentItem.valueAtRisk)}
                        </Badge>
                      )}
                      {currentItem.dueDate && currentItem.dueDate < new Date().toISOString().split("T")[0] && (
                        <Badge variant="critical" className="text-[10px]">VENCIDA</Badge>
                      )}
                      {currentItem.confidence != null && (
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(currentItem.confidence * 100)}% confianza
                        </Badge>
                      )}
                    </div>

                    {/* Contact / Company links */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
                      {currentItem.contactName && (
                        <Link
                          href={currentItem.contactId ? `/contacts/${currentItem.contactId}` : "#"}
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <User className="h-3 w-3" />
                          {currentItem.contactName}
                        </Link>
                      )}
                      {currentItem.companyId && (
                        <Link
                          href={`/companies/${currentItem.companyId}`}
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {currentItem.companyName ?? `Empresa #${currentItem.companyId}`}
                        </Link>
                      )}
                      {currentItem.assignee && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {currentItem.assignee}
                        </span>
                      )}
                      {currentItem.dueDate && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {currentItem.dueDate}
                        </span>
                      )}
                    </div>

                    {/* Suggested action / Recommendation */}
                    {currentItem.suggestedAction && (
                      <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm mb-3">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                          {currentItem.type === "insight" ? "Recomendacion" : "Sugerencia IA"}
                        </div>
                        <p className="text-muted-foreground leading-relaxed">
                          {currentItem.suggestedAction}
                        </p>
                      </div>
                    )}

                    {/* Description (truncated, expandable) */}
                    {currentItem.description && (
                      <div className="mb-3">
                        <p className={cn(
                          "text-sm text-muted-foreground leading-relaxed",
                          !expandedDescription && "line-clamp-3"
                        )}>
                          {currentItem.description}
                        </p>
                        {currentItem.description.length > 150 && (
                          <button
                            className="flex items-center gap-1 text-xs text-primary mt-1 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedDescription(!expandedDescription);
                            }}
                          >
                            {expandedDescription ? (
                              <>Menos <ChevronUp className="h-3 w-3" /></>
                            ) : (
                              <>Mas <ChevronDown className="h-3 w-3" /></>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Swipe hint */}
                    <div className="text-center text-[10px] text-muted-foreground/50 mt-2 pb-1">
                      &larr; desliza para descartar &middot; desliza para actuar &rarr;
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Bottom action buttons ── */}
            {currentItem && (
              <div className="flex items-center justify-center gap-4 pt-2">
                {/* Dismiss (left) */}
                <button
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all hover:scale-110 active:scale-95 shadow-sm"
                  onClick={() => dismiss(currentItem)}
                  title="Descartar"
                >
                  <X className="h-6 w-6" />
                </button>

                {/* Detail (center) */}
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all hover:scale-110 active:scale-95 shadow-sm"
                  onClick={() => goToDetail(currentItem)}
                  title="Ver detalle"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>

                {/* Act (right) */}
                <button
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all hover:scale-110 active:scale-95 shadow-sm disabled:opacity-50"
                  onClick={() => createActionFromAlert(currentItem)}
                  disabled={creatingAction === currentItem.id}
                  title={currentItem.type === "alert" ? "Crear accion" : currentItem.type === "action" ? "Completar" : "Actuar"}
                >
                  {creatingAction === currentItem.id ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Check className="h-6 w-6" />
                  )}
                </button>
              </div>
            )}

            {/* Button labels */}
            {currentItem && (
              <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                <span className="w-14 text-center">Descartar</span>
                <span className="w-11 text-center">Detalle</span>
                <span className="w-14 text-center">
                  {currentItem.type === "alert" ? "Crear accion" : currentItem.type === "action" ? "Completar" : "Actuar"}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
