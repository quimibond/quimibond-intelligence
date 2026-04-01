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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

interface CompanyProfile {
  company_id: number;
  name: string;
  total_revenue: number;
  revenue_90d: number;
  trend_pct: number | null;
  overdue_amount: number;
  tier: string;
  risk_level: string;
}

interface CompanyGroup {
  company: CompanyProfile | null;
  companyName: string;
  insights: Insight[];
  maxSeverity: string;
  totalImpact: number;
}

type ViewMode = "list" | "company";

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  sales: TrendingUp, finance: DollarSign, operations: Truck,
  relationships: Users, risk: Shield, growth: Zap, meta: Bot,
};
const DOMAIN_COLORS: Record<string, string> = {
  sales: "text-domain-sales", finance: "text-domain-finance", operations: "text-domain-operations",
  relationships: "text-domain-relationships", risk: "text-domain-risk", growth: "text-domain-growth", meta: "text-domain-meta",
};
const DOMAIN_BG: Record<string, string> = {
  sales: "bg-domain-sales/10", finance: "bg-domain-finance/10", operations: "bg-domain-operations/10",
  relationships: "bg-domain-relationships/10", risk: "bg-domain-risk/10", growth: "bg-domain-growth/10", meta: "bg-domain-meta/10",
};
const TIER_LABELS: Record<string, { label: string; color: string }> = {
  urgent: { label: "URGENTE", color: "bg-danger text-white" },
  important: { label: "IMPORTANTE", color: "bg-warning text-white" },
  fyi: { label: "FYI", color: "bg-info/20 text-info-foreground" },
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

  // Filters & view
  const [viewMode, setViewMode] = useState<ViewMode>("company");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [companyProfiles, setCompanyProfiles] = useState<Map<number, CompanyProfile>>(new Map());

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

  // All assignees (fetched once, not limited by page)
  const [allAssignees, setAllAssignees] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [insightsRes, agentsRes, freshnessRes, assigneesRes, profilesRes] = await Promise.all([
      supabase
        .from("agent_insights")
        .select("*")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("ai_agents").select("id, slug, name, domain"),
      Promise.all([
        supabase.from("odoo_users").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        supabase.from("emails").select("created_at").order("created_at", { ascending: false }).limit(1),
        supabase.from("agent_runs").select("completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
      ]),
      // Get ALL unique assignees (not limited by page size)
      supabase
        .from("agent_insights")
        .select("assignee_name")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .not("assignee_name", "is", null),
      // Company profiles for grouping
      supabase
        .from("company_profile")
        .select("company_id, name, total_revenue, revenue_90d, trend_pct, overdue_amount, tier, risk_level")
        .order("total_revenue", { ascending: false }),
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

    // Build company profile map
    const profileMap = new Map<number, CompanyProfile>();
    for (const p of profilesRes.data ?? []) {
      profileMap.set(p.company_id, p as CompanyProfile);
    }
    setCompanyProfiles(profileMap);

    // Extract all unique assignees from full dataset (not limited by page)
    const assigneeNames = Array.from(new Set(
      (assigneesRes.data ?? []).map((r: { assignee_name: string }) => r.assignee_name).filter(Boolean)
    )) as string[];
    setAllAssignees(assigneeNames.sort());

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

  // Assignees from allAssignees (full dataset, not limited by page)

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
          <PartyPopper className="h-16 w-16 text-success" />
          <div className="absolute inset-0 animate-ping opacity-20">
            <PartyPopper className="h-16 w-16 text-success" />
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
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastSync, 2) ? "bg-success" : isRecent(freshness.lastSync, 6) ? "bg-warning" : "bg-danger")} />
              Odoo: {timeAgo(freshness.lastSync)}
            </span>
          )}
          {freshness.lastAnalyze && (
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAnalyze, 1) ? "bg-success" : isRecent(freshness.lastAnalyze, 4) ? "bg-warning" : "bg-danger")} />
              Emails: {timeAgo(freshness.lastAnalyze)}
            </span>
          )}
          {freshness.lastAgents && (
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAgents, 6) ? "bg-success" : isRecent(freshness.lastAgents, 12) ? "bg-warning" : "bg-danger")} />
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
                filterMode === "urgent" ? "bg-danger text-white" : "bg-danger/10 text-danger-foreground hover:bg-danger/20"
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
                filterMode === "important" ? "bg-warning text-white" : "bg-warning/10 text-warning-foreground hover:bg-warning/20"
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
                filterMode === "fyi" ? "bg-info text-white" : "bg-info/10 text-info-foreground hover:bg-info/20"
              )}
            >
              FYI ({tierCounts.fyi})
            </button>
          )}

          {/* Assignee filter */}
          {allAssignees.length > 1 && (
            <>
              <div className="h-4 w-px bg-border shrink-0 mx-1" />
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="shrink-0 rounded-full border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
              >
                <option value="all">Todos los responsables</option>
                {allAssignees.sort().map(name => (
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
                    <div className="absolute inset-0 bg-success/10 rounded-2xl pointer-events-none flex items-center justify-center">
                      <ThumbsUp className="h-16 w-16 text-success opacity-50" />
                    </div>
                  )}
                  {swipeX < -30 && (
                    <div className="absolute inset-0 bg-danger/10 rounded-2xl pointer-events-none flex items-center justify-center">
                      <X className="h-16 w-16 text-danger opacity-50" />
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
                      <div className="mt-3 rounded-lg bg-success/5 border border-success/20 p-3">
                        <p className="text-xs font-medium text-success-foreground mb-1">Accion sugerida</p>
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
                  <div className="h-14 w-14 rounded-full border-2 border-danger/40 flex items-center justify-center hover:bg-danger/10 active:scale-95 transition-all">
                    <X className="h-6 w-6 text-danger" />
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
                  <div className="h-12 w-12 rounded-full border-2 border-info/40 flex items-center justify-center hover:bg-info/10 active:scale-95 transition-all">
                    <Eye className="h-5 w-5 text-info" />
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
                  <div className="h-14 w-14 rounded-full border-2 border-success/40 flex items-center justify-center hover:bg-success/10 active:scale-95 transition-all">
                    <ThumbsUp className="h-6 w-6 text-success" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Util</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: View toggle                                             */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {filteredInsights.length > 0 && (
        <div className="hidden md:flex items-center gap-1 mb-3 px-0">
          <button
            onClick={() => setViewMode("company")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "company" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Por empresa
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "list" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Lista
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Company grouped view                                    */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {filteredInsights.length > 0 && viewMode === "company" && (() => {
        // Group insights by company
        const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        const groups = new Map<string, CompanyGroup>();

        for (const insight of filteredInsights) {
          const key = insight.company_id ? String(insight.company_id) : "_no_company";
          if (!groups.has(key)) {
            const profile = insight.company_id ? companyProfiles.get(insight.company_id) : null;
            groups.set(key, {
              company: profile ?? null,
              companyName: profile?.name ?? "Sin empresa asignada",
              insights: [],
              maxSeverity: "info",
              totalImpact: 0,
            });
          }
          const group = groups.get(key)!;
          group.insights.push(insight);
          if ((severityOrder[insight.severity] ?? 5) < (severityOrder[group.maxSeverity] ?? 5)) {
            group.maxSeverity = insight.severity;
          }
          if (insight.business_impact_estimate) group.totalImpact += insight.business_impact_estimate;
        }

        // Sort groups: by max severity, then by total revenue
        const sortedGroups = [...groups.values()].sort((a, b) => {
          const sevDiff = (severityOrder[a.maxSeverity] ?? 5) - (severityOrder[b.maxSeverity] ?? 5);
          if (sevDiff !== 0) return sevDiff;
          return (b.company?.total_revenue ?? 0) - (a.company?.total_revenue ?? 0);
        });

        const TIER_COLORS: Record<string, string> = {
          strategic: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
          important: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
          key_supplier: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
          regular: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
        };
        const RISK_COLORS: Record<string, string> = {
          critical: "text-danger", high: "text-danger", medium: "text-warning", low: "text-muted-foreground",
        };

        return (
          <div className="hidden md:block space-y-3">
            {sortedGroups.map((group) => (
              <Card key={group.companyName} className="overflow-hidden">
                {/* Company header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-1 h-8 rounded-full",
                      group.maxSeverity === "critical" && "bg-danger",
                      group.maxSeverity === "high" && "bg-warning",
                      group.maxSeverity === "medium" && "bg-info",
                      !["critical", "high", "medium"].includes(group.maxSeverity) && "bg-muted-foreground/30",
                    )} />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{group.companyName}</h3>
                        {group.company?.tier && (
                          <Badge className={cn("text-[10px] font-normal", TIER_COLORS[group.company.tier] ?? "bg-muted")}>
                            {group.company.tier}
                          </Badge>
                        )}
                        {group.company?.risk_level && group.company.risk_level !== "low" && (
                          <span className={cn("text-[10px] font-medium", RISK_COLORS[group.company.risk_level])}>
                            riesgo {group.company.risk_level}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        {group.company?.total_revenue ? (
                          <span>Revenue: {formatCurrency(group.company.total_revenue)}</span>
                        ) : null}
                        {group.company?.overdue_amount ? (
                          <span className="text-danger">Vencido: {formatCurrency(group.company.overdue_amount)}</span>
                        ) : null}
                        {group.company?.trend_pct != null ? (
                          <span className={group.company.trend_pct >= 0 ? "text-success" : "text-danger"}>
                            {group.company.trend_pct >= 0 ? "+" : ""}{group.company.trend_pct.toFixed(0)}% tendencia
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground">{group.insights.length} insight{group.insights.length !== 1 ? "s" : ""}</span>
                    {group.totalImpact > 0 && (
                      <div className="text-xs font-semibold">{formatCurrency(group.totalImpact)}</div>
                    )}
                  </div>
                </div>
                {/* Insights list */}
                <div className="divide-y">
                  {group.insights.map((insight) => {
                    const agent = agents[insight.agent_id];
                    const Icon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
                    const isSeen = seenIds.has(insight.id);
                    return (
                      <div
                        key={insight.id}
                        className={cn("flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/30 group", !isSeen && "bg-accent/30")}
                        onClick={() => goToDetail(insight.id)}
                      >
                        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md shrink-0", DOMAIN_BG[agent?.domain ?? ""] ?? "bg-muted")}>
                          <Icon className={cn("h-3.5 w-3.5", DOMAIN_COLORS[agent?.domain ?? ""])} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {!isSeen && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                            <h4 className={cn("text-sm truncate", !isSeen ? "font-semibold" : "font-normal")}>{insight.title}</h4>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <SeverityBadge severity={insight.severity} />
                            <span className="text-[10px] text-muted-foreground">{agent?.name?.replace("Agente de ", "")}</span>
                            {insight.assignee_name && (
                              <span className="text-[10px] text-muted-foreground">
                                 {insight.assignee_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actOnInsight(insight.id)} disabled={acting === insight.id}>
                            {acting === insight.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => dismissInsight(insight.id)}>
                            <ThumbsDown className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{timeAgo(insight.created_at)}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Table view (hidden on mobile)                           */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {filteredInsights.length > 0 && viewMode === "list" && (
        <div className="hidden md:block rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[3px] p-0" />
                <TableHead className="pl-3">Insight</TableHead>
                <TableHead className="hidden lg:table-cell">Responsable</TableHead>
                <TableHead className="hidden lg:table-cell w-20 text-right">Impacto</TableHead>
                <TableHead className="w-16 text-right">Conf.</TableHead>
                <TableHead className="w-20 text-right">Tiempo</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInsights.map((insight) => {
                const agent = agents[insight.agent_id];
                const Icon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
                const tier = computeTier(insight);
                const isSeen = seenIds.has(insight.id);

                return (
                  <TableRow
                    key={insight.id}
                    className={cn(
                      "group cursor-pointer",
                      !isSeen && "bg-accent/50",
                    )}
                    onClick={() => goToDetail(insight.id)}
                  >
                    {/* Tier indicator stripe */}
                    <TableCell className="p-0 w-[3px]">
                      <div className={cn(
                        "w-[3px] h-full",
                        tier === "urgent" && "bg-danger",
                        tier === "important" && "bg-warning",
                      )} />
                    </TableCell>

                    {/* Main content: icon + title + meta */}
                    <TableCell className="pl-3">
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md shrink-0", DOMAIN_BG[agent?.domain ?? ""] ?? "bg-muted")}>
                          <Icon className={cn("h-4 w-4", DOMAIN_COLORS[agent?.domain ?? ""])} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {!isSeen && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                            <h3 className={cn("text-sm truncate", !isSeen ? "font-semibold" : "font-normal")}>{insight.title}</h3>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <SeverityBadge severity={insight.severity} />
                            <span className="text-[11px] text-muted-foreground">{agent?.name?.replace("Agente de ", "")}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Assignee */}
                    <TableCell className="hidden lg:table-cell">
                      {insight.assignee_name ? (
                        <span className="text-sm text-muted-foreground">{insight.assignee_name}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground/40">—</span>
                      )}
                    </TableCell>

                    {/* Impact */}
                    <TableCell className="hidden lg:table-cell text-right">
                      {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 ? (
                        <span className="text-sm font-medium tabular-nums">${(insight.business_impact_estimate / 1000).toFixed(0)}K</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>

                    {/* Confidence */}
                    <TableCell className="text-right">
                      <span className={cn(
                        "text-sm tabular-nums font-medium",
                        insight.confidence >= 0.85 ? "text-success" : insight.confidence >= 0.7 ? "text-warning" : "text-muted-foreground"
                      )}>
                        {(insight.confidence * 100).toFixed(0)}%
                      </span>
                    </TableCell>

                    {/* Time */}
                    <TableCell className="text-right">
                      <span className="text-[13px] text-muted-foreground whitespace-nowrap">{timeAgo(insight.created_at)}</span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => actOnInsight(insight.id)}
                              disabled={acting === insight.id}
                            >
                              {acting === insight.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Util</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground"
                              onClick={() => dismissInsight(insight.id)}
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Descartar</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
