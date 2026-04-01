"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot, CheckCircle2, ChevronLeft, ChevronRight, Clock, DollarSign,
  Eye, Filter, Loader2, PartyPopper, RefreshCw, Shield,
  SkipForward, ThumbsDown, ThumbsUp, TrendingUp, Truck, Users,
  X, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──

interface Insight {
  id: number;
  agent_id: number;
  agent_slug?: string;
  agent_name?: string;
  agent_domain?: string;
  assignee_email: string | null;
  assignee_name: string | null;
  assignee_department: string | null;
  insight_type: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  confidence: number;
  business_impact_estimate: number | null;
  evidence: unknown[];
  state: string;
  company_id: number | null;
  contact_id: number | null;
  created_at: string;
}

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  sales: TrendingUp, finance: DollarSign, operations: Truck,
  relationships: Users, risk: Shield, growth: Zap, meta: Bot,
};
const DOMAIN_COLORS: Record<string, string> = {
  sales: "text-emerald-500", finance: "text-amber-500", operations: "text-blue-500",
  relationships: "text-purple-500", risk: "text-red-500", growth: "text-cyan-500", meta: "text-indigo-500",
};
const DOMAIN_BG: Record<string, string> = {
  sales: "bg-emerald-500/10", finance: "bg-amber-500/10", operations: "bg-blue-500/10",
  relationships: "bg-purple-500/10", risk: "bg-red-500/10", growth: "bg-cyan-500/10", meta: "bg-indigo-500/10",
};
const TIER_LABELS: Record<string, { label: string; color: string }> = {
  urgent: { label: "URGENTE", color: "bg-red-500 text-white" },
  important: { label: "IMPORTANTE", color: "bg-amber-500 text-white" },
  fyi: { label: "FYI", color: "bg-blue-500/20 text-blue-600 dark:text-blue-400" },
};

type FilterMode = "all" | "urgent" | "important" | "fyi";
type AssigneeFilter = "all" | string;

function isRecent(dateStr: string, hoursThreshold: number): boolean {
  return (Date.now() - new Date(dateStr).getTime()) < hoursThreshold * 3600_000;
}

function getTier(insight: Insight): string {
  const ev = insight.evidence as { priority_tier?: string }[];
  return ev?.[0]?.priority_tier ?? "fyi";
}

function computeTier(insight: Insight): string {
  // Compute tier from severity if not in evidence
  const evTier = getTier(insight);
  if (evTier !== "fyi") return evTier;
  // Fallback: map severity to tier
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}

export default function InboxPage() {
  const router = useRouter();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [agents, setAgents] = useState<Record<number, { slug: string; name: string; domain: string }>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<{ lastSync: string | null; lastAnalyze: string | null; lastAgents: string | null }>({ lastSync: null, lastAnalyze: null, lastAgents: null });
  const [seenIds, setSeenIds] = useState<Set<number>>(new Set());

  // Filters
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");

  // Mobile swipe state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const isHorizontalRef = useRef(false);

  // Load seen IDs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("qb-seen-insights");
      if (stored) setSeenIds(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const markSeen = useCallback((id: number) => {
    setSeenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      // Keep only last 200 seen IDs to prevent localStorage bloat
      const arr = Array.from(next);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      const trimmed = new Set(arr);
      try { localStorage.setItem("qb-seen-insights", JSON.stringify(Array.from(trimmed))); } catch { /* ignore */ }
      return trimmed;
    });
  }, []);

  const load = useCallback(async () => {
    const [insightsRes, agentsRes, freshnessRes] = await Promise.all([
      supabase
        .from("agent_insights")
        .select("*")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("ai_agents").select("id, slug, name, domain"),
      Promise.all([
        supabase.from("odoo_users").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        supabase.from("emails").select("created_at").order("created_at", { ascending: false }).limit(1),
        supabase.from("agent_runs").select("completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
      ]),
    ]);

    const [odooFresh, emailFresh, agentFresh] = freshnessRes;
    setFreshness({
      lastSync: odooFresh.data?.[0]?.updated_at ?? null,
      lastAnalyze: emailFresh.data?.[0]?.created_at ?? null,
      lastAgents: agentFresh.data?.[0]?.completed_at ?? null,
    });

    const agentMap: Record<number, { slug: string; name: string; domain: string }> = {};
    for (const a of agentsRes.data ?? []) {
      agentMap[a.id] = { slug: a.slug, name: a.name, domain: a.domain };
    }
    setAgents(agentMap);

    // Sort by severity priority
    const sorted = (insightsRes.data ?? []).sort((a, b) => {
      const tierOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (tierOrder[a.severity] ?? 5) - (tierOrder[b.severity] ?? 5);
    });

    setInsights(sorted);
    setCurrentIndex(0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Real-time subscription for new insights ──
  useEffect(() => {
    const channel = supabase
      .channel("inbox-new-insights")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_insights" },
        (payload) => {
          const newInsight = payload.new as Insight;
          if (newInsight.confidence >= 0.65 && ["new", "seen"].includes(newInsight.state)) {
            setInsights(prev => {
              if (prev.find(i => i.id === newInsight.id)) return prev;
              return [newInsight, ...prev];
            });
            toast("Nuevo insight de tus agentes", {
              description: newInsight.title,
              duration: 5000,
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Filter logic ──
  const filteredInsights = insights.filter(insight => {
    // Tier filter
    if (filterMode !== "all") {
      const tier = computeTier(insight);
      if (tier !== filterMode) return false;
    }
    // Assignee filter
    if (assigneeFilter !== "all") {
      if (insight.assignee_name !== assigneeFilter) return false;
    }
    return true;
  });

  // Get unique assignees for filter
  const uniqueAssignees = Array.from(new Set(insights.map(i => i.assignee_name).filter(Boolean))) as string[];

  // Count by tier
  const tierCounts = { urgent: 0, important: 0, fyi: 0 };
  for (const insight of insights) {
    const tier = computeTier(insight);
    if (tier in tierCounts) tierCounts[tier as keyof typeof tierCounts]++;
  }

  // ── Actions ──

  const actOnInsight = useCallback(async (id: number) => {
    setActing(id);
    await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", id);
    setInsights(prev => prev.filter(i => i.id !== id));
    toast.success("Marcado como util — el sistema aprendera de esto");
    setActing(null);
  }, []);

  const dismissInsight = useCallback(async (id: number) => {
    await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", id);
    setInsights(prev => prev.filter(i => i.id !== id));
    toast("Descartado — el sistema ajustara sus prioridades");
  }, []);

  const goToDetail = useCallback((id: number) => {
    markSeen(id);
    router.push(`/inbox/insight/${id}`);
  }, [router, markSeen]);

  // ── Mobile: ensure currentIndex is valid for filtered list ──
  const mobileInsights = filteredInsights;
  const safeIndex = Math.min(currentIndex, Math.max(0, mobileInsights.length - 1));
  const currentInsight = mobileInsights[safeIndex];

  // ── Mobile swipe handlers ──

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isHorizontalRef.current = false;
    setIsSwiping(false);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    if (!isHorizontalRef.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isHorizontalRef.current = true;
    }
    if (isHorizontalRef.current) {
      setSwipeX(dx);
      setIsSwiping(true);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!isSwiping || !currentInsight) { setSwipeX(0); setIsSwiping(false); return; }

    if (swipeX > 100) {
      actOnInsight(currentInsight.id);
    } else if (swipeX < -100) {
      dismissInsight(currentInsight.id);
    }
    setSwipeX(0);
    setIsSwiping(false);
  }, [swipeX, isSwiping, currentInsight, actOnInsight, dismissInsight]);

  const goNextCard = useCallback(() => {
    if (safeIndex < mobileInsights.length - 1) {
      if (currentInsight) markSeen(currentInsight.id);
      setCurrentIndex(safeIndex + 1);
    }
  }, [safeIndex, mobileInsights.length, currentInsight, markSeen]);

  const goPrevCard = useCallback(() => {
    if (safeIndex > 0) setCurrentIndex(safeIndex - 1);
  }, [safeIndex]);

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-24 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="py-3 px-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-12" />
                  </div>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            </CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="relative">
          <PartyPopper className="h-16 w-16 text-emerald-500" />
          <div className="absolute inset-0 animate-ping opacity-20">
            <PartyPopper className="h-16 w-16 text-emerald-500" />
          </div>
        </div>
        <h2 className="text-xl font-bold">Todo al dia</h2>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          No hay insights pendientes. Los agentes te notificaran cuando detecten algo relevante.
        </p>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-4 py-3 md:px-0 md:py-0 md:mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg md:text-2xl font-bold">Inbox</h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              {insights.length} insight{insights.length !== 1 ? "s" : ""} pendiente{insights.length !== 1 ? "s" : ""}
              {filteredInsights.length !== insights.length && (
                <span className="ml-1">({filteredInsights.length} filtrado{filteredInsights.length !== 1 ? "s" : ""})</span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Freshness indicators */}
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          {freshness.lastSync && (
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastSync, 2) ? "bg-emerald-500" : isRecent(freshness.lastSync, 6) ? "bg-amber-500" : "bg-red-500")} />
              Odoo: {timeAgo(freshness.lastSync)}
            </span>
          )}
          {freshness.lastAnalyze && (
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAnalyze, 1) ? "bg-emerald-500" : isRecent(freshness.lastAnalyze, 4) ? "bg-amber-500" : "bg-red-500")} />
              Emails: {timeAgo(freshness.lastAnalyze)}
            </span>
          )}
          {freshness.lastAgents && (
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAgents, 6) ? "bg-emerald-500" : isRecent(freshness.lastAgents, 12) ? "bg-amber-500" : "bg-red-500")} />
              Agentes: {timeAgo(freshness.lastAgents)}
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          <button
            onClick={() => setFilterMode("all")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filterMode === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Todos ({insights.length})
          </button>
          {tierCounts.urgent > 0 && (
            <button
              onClick={() => setFilterMode(filterMode === "urgent" ? "all" : "urgent")}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filterMode === "urgent" ? "bg-red-500 text-white" : "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
              )}
            >
              Urgente ({tierCounts.urgent})
            </button>
          )}
          {tierCounts.important > 0 && (
            <button
              onClick={() => setFilterMode(filterMode === "important" ? "all" : "important")}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filterMode === "important" ? "bg-amber-500 text-white" : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
              )}
            >
              Importante ({tierCounts.important})
            </button>
          )}
          {tierCounts.fyi > 0 && (
            <button
              onClick={() => setFilterMode(filterMode === "fyi" ? "all" : "fyi")}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filterMode === "fyi" ? "bg-blue-500 text-white" : "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
              )}
            >
              FYI ({tierCounts.fyi})
            </button>
          )}

          {/* Assignee filter */}
          {uniqueAssignees.length > 1 && (
            <>
              <div className="h-4 w-px bg-border shrink-0 mx-1" />
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="shrink-0 rounded-full border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
              >
                <option value="all">Todos los responsables</option>
                {uniqueAssignees.sort().map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Empty filtered state */}
      {filteredInsights.length === 0 && insights.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Filter className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay insights con este filtro</p>
          <Button variant="ghost" size="sm" onClick={() => { setFilterMode("all"); setAssigneeFilter("all"); }}>
            Limpiar filtros
          </Button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* MOBILE: Swipeable cards (hidden on md+)                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {filteredInsights.length > 0 && (
        <div className="md:hidden px-4 pb-24">
          {currentInsight && (
            <>
              {/* Progress bar */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/30 rounded-full transition-all"
                    style={{ width: `${((safeIndex + 1) / mobileInsights.length) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{safeIndex + 1}/{mobileInsights.length}</span>
              </div>

              {/* Card stack */}
              <div className="relative h-[420px]">
                {/* Background cards */}
                {mobileInsights[safeIndex + 2] && (
                  <div className="absolute inset-x-2 top-4 h-full rounded-2xl border bg-card opacity-30 scale-[0.92]" />
                )}
                {mobileInsights[safeIndex + 1] && (
                  <div className="absolute inset-x-1 top-2 h-full rounded-2xl border bg-card opacity-50 scale-[0.96]" />
                )}

                {/* Active card */}
                <div
                  className={cn(
                    "absolute inset-0 rounded-2xl border bg-card shadow-lg overflow-hidden transition-transform",
                    !seenIds.has(currentInsight.id) && "ring-2 ring-primary/30"
                  )}
                  style={{
                    transform: isSwiping ? `translateX(${swipeX}px) rotate(${swipeX * 0.05}deg)` : "none",
                  }}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                >
                  {/* Swipe indicators */}
                  {swipeX > 30 && (
                    <div className="absolute inset-0 bg-emerald-500/10 rounded-2xl pointer-events-none flex items-center justify-center">
                      <ThumbsUp className="h-16 w-16 text-emerald-500 opacity-50" />
                    </div>
                  )}
                  {swipeX < -30 && (
                    <div className="absolute inset-0 bg-red-500/10 rounded-2xl pointer-events-none flex items-center justify-center">
                      <X className="h-16 w-16 text-red-500 opacity-50" />
                    </div>
                  )}

                  <div className="p-5 h-full flex flex-col">
                    {/* Agent + tier */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const agent = agents[currentInsight.agent_id];
                          const Icon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
                          return (
                            <>
                              <div className={cn("flex h-6 w-6 items-center justify-center rounded-full", DOMAIN_BG[agent?.domain ?? ""])}>
                                <Icon className={cn("h-3.5 w-3.5", DOMAIN_COLORS[agent?.domain ?? ""])} />
                              </div>
                              <span className="text-xs font-medium text-muted-foreground">
                                {agent?.name?.replace("Agente de ", "") ?? "Agente"}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      {(() => {
                        const tier = computeTier(currentInsight);
                        const cfg = TIER_LABELS[tier] ?? TIER_LABELS.fyi;
                        return <Badge className={cn("text-[10px]", cfg.color)}>{cfg.label}</Badge>;
                      })()}
                    </div>

                    {/* Severity + type + assignee */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <SeverityBadge severity={currentInsight.severity} />
                      <Badge variant="outline" className="text-[10px]">{currentInsight.insight_type}</Badge>
                      {currentInsight.assignee_name && (
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          → {currentInsight.assignee_name}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h2 className="text-base font-bold leading-snug mb-2">{currentInsight.title}</h2>

                    {/* Description */}
                    <p className="text-sm text-muted-foreground leading-relaxed flex-1 overflow-y-auto">{currentInsight.description}</p>

                    {/* Recommendation */}
                    {currentInsight.recommendation && (
                      <div className="mt-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Accion sugerida</p>
                        <p className="text-sm">{currentInsight.recommendation}</p>
                      </div>
                    )}

                    {/* Impact + time */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-muted-foreground">
                      <span>{timeAgo(currentInsight.created_at)}</span>
                      <div className="flex items-center gap-3">
                        {currentInsight.business_impact_estimate != null && currentInsight.business_impact_estimate > 0 && (
                          <span className="font-semibold text-foreground">{formatCurrency(currentInsight.business_impact_estimate)}</span>
                        )}
                        <span className="tabular-nums">{(currentInsight.confidence * 100).toFixed(0)}% confianza</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-center gap-4 mt-6">
                <button
                  onClick={() => dismissInsight(currentInsight.id)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="h-14 w-14 rounded-full border-2 border-red-300 dark:border-red-500/40 flex items-center justify-center hover:bg-red-500/10 active:scale-95 transition-all">
                    <X className="h-6 w-6 text-red-500" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Descartar</span>
                </button>

                {/* Navigation: prev */}
                <button
                  onClick={goPrevCard}
                  disabled={safeIndex === 0}
                  className="flex flex-col items-center gap-1"
                >
                  <div className={cn(
                    "h-10 w-10 rounded-full border-2 border-border flex items-center justify-center transition-all",
                    safeIndex === 0 ? "opacity-30" : "hover:bg-muted active:scale-95"
                  )}>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>

                <button
                  onClick={() => goToDetail(currentInsight.id)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="h-12 w-12 rounded-full border-2 border-blue-300 dark:border-blue-500/40 flex items-center justify-center hover:bg-blue-500/10 active:scale-95 transition-all">
                    <Eye className="h-5 w-5 text-blue-500" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Detalle</span>
                </button>

                {/* Navigation: next / skip */}
                <button
                  onClick={goNextCard}
                  disabled={safeIndex >= mobileInsights.length - 1}
                  className="flex flex-col items-center gap-1"
                >
                  <div className={cn(
                    "h-10 w-10 rounded-full border-2 border-border flex items-center justify-center transition-all",
                    safeIndex >= mobileInsights.length - 1 ? "opacity-30" : "hover:bg-muted active:scale-95"
                  )}>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>

                <button
                  onClick={() => actOnInsight(currentInsight.id)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="h-14 w-14 rounded-full border-2 border-emerald-300 dark:border-emerald-500/40 flex items-center justify-center hover:bg-emerald-500/10 active:scale-95 transition-all">
                    <ThumbsUp className="h-6 w-6 text-emerald-500" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Util</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Professional list view (hidden on mobile)               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {filteredInsights.length > 0 && (
        <div className="hidden md:block space-y-2">
          {filteredInsights.map((insight) => {
            const agent = agents[insight.agent_id];
            const Icon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
            const tier = computeTier(insight);
            const tierCfg = TIER_LABELS[tier] ?? TIER_LABELS.fyi;
            const isSeen = seenIds.has(insight.id);

            return (
              <Card
                key={insight.id}
                className={cn(
                  "group cursor-pointer transition-all hover:border-primary/20 hover:shadow-sm",
                  tier === "urgent" && "border-l-4 border-l-red-500",
                  tier === "important" && "border-l-4 border-l-amber-500",
                  !isSeen && "bg-primary/[0.02]",
                )}
                onClick={() => goToDetail(insight.id)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    {/* Agent icon */}
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-full shrink-0", DOMAIN_BG[agent?.domain ?? ""] ?? "bg-muted")}>
                      <Icon className={cn("h-5 w-5", DOMAIN_COLORS[agent?.domain ?? ""])} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {!isSeen && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                        <Badge className={cn("text-[10px] px-1.5", tierCfg.color)}>{tierCfg.label}</Badge>
                        <SeverityBadge severity={insight.severity} />
                        <span className="text-[10px] text-muted-foreground">{agent?.name?.replace("Agente de ", "")}</span>
                        {insight.assignee_name && (
                          <span className="text-[10px] text-muted-foreground">→ {insight.assignee_name}</span>
                        )}
                      </div>
                      <h3 className={cn("text-sm truncate", !isSeen ? "font-bold" : "font-medium")}>{insight.title}</h3>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{insight.recommendation ?? insight.description}</p>
                    </div>

                    {/* Right side: metrics + actions */}
                    <div className="flex items-center gap-4 shrink-0">
                      {/* Impact */}
                      {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 && (
                        <div className="text-center hidden lg:block">
                          <p className="text-sm font-bold">${(insight.business_impact_estimate / 1000).toFixed(0)}K</p>
                          <p className="text-[10px] text-muted-foreground">impacto</p>
                        </div>
                      )}

                      {/* Confidence */}
                      <div className="text-center hidden lg:block">
                        <p className={cn(
                          "text-sm font-bold tabular-nums",
                          insight.confidence >= 0.85 ? "text-emerald-500" : insight.confidence >= 0.7 ? "text-amber-500" : "text-muted-foreground"
                        )}>
                          {(insight.confidence * 100).toFixed(0)}%
                        </p>
                      </div>

                      {/* Time */}
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(insight.created_at)}</p>
                      </div>

                      {/* Quick actions — always visible on the right */}
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => actOnInsight(insight.id)}
                          disabled={acting === insight.id}
                          title="Marcar como util"
                        >
                          {acting === insight.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          onClick={() => dismissInsight(insight.id)}
                          title="Descartar"
                        >
                          <ThumbsDown className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Arrow */}
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
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
