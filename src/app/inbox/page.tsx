"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot, CheckCircle2, ChevronRight, Clock, DollarSign,
  Eye, Loader2, PartyPopper, RefreshCw, Shield,
  ThumbsDown, ThumbsUp, TrendingUp, Truck, Users,
  X, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ── Types ──

interface Insight {
  id: number;
  agent_id: number;
  agent_slug?: string;
  agent_name?: string;
  agent_domain?: string;
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
const TIER_LABELS: Record<string, { label: string; color: string }> = {
  urgent: { label: "URGENTE", color: "bg-red-500 text-white" },
  important: { label: "IMPORTANTE", color: "bg-amber-500 text-white" },
  fyi: { label: "FYI", color: "bg-blue-500/20 text-blue-600" },
};

export default function InboxPage() {
  const router = useRouter();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [agents, setAgents] = useState<Record<number, { slug: string; name: string; domain: string }>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  // Mobile swipe state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const isHorizontalRef = useRef(false);

  const load = useCallback(async () => {
    const [insightsRes, agentsRes] = await Promise.all([
      supabase
        .from("agent_insights")
        .select("*")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("ai_agents").select("id, slug, name, domain"),
    ]);

    // Build agent map
    const agentMap: Record<number, { slug: string; name: string; domain: string }> = {};
    for (const a of agentsRes.data ?? []) {
      agentMap[a.id] = { slug: a.slug, name: a.name, domain: a.domain };
    }
    setAgents(agentMap);

    // Sort by priority tier
    const sorted = (insightsRes.data ?? []).sort((a, b) => {
      const tierOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (tierOrder[a.severity] ?? 5) - (tierOrder[b.severity] ?? 5);
    });

    setInsights(sorted);
    setCurrentIndex(0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Actions ──

  const actOnInsight = useCallback(async (id: number) => {
    setActing(id);
    await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", id);
    setInsights(prev => prev.filter(i => i.id !== id));
    if (currentIndex >= insights.length - 1) setCurrentIndex(Math.max(0, currentIndex - 1));
    toast.success("Marcado como util");
    setActing(null);
  }, [currentIndex, insights.length]);

  const dismissInsight = useCallback(async (id: number) => {
    await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", id);
    setInsights(prev => prev.filter(i => i.id !== id));
    if (currentIndex >= insights.length - 1) setCurrentIndex(Math.max(0, currentIndex - 1));
    toast("Descartado");
  }, [currentIndex, insights.length]);

  const goToDetail = useCallback((id: number) => {
    router.push(`/inbox/insight/${id}`);
  }, [router]);

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
    if (!isSwiping) return;
    const current = insights[currentIndex];
    if (!current) { setSwipeX(0); setIsSwiping(false); return; }

    if (swipeX > 100) {
      actOnInsight(current.id);
    } else if (swipeX < -100) {
      dismissInsight(current.id);
    }
    setSwipeX(0);
    setIsSwiping(false);
  }, [swipeX, isSwiping, insights, currentIndex, actOnInsight, dismissInsight]);

  // ── Get priority tier ──
  function getTier(insight: Insight): string {
    const ev = insight.evidence as { priority_tier?: string }[];
    return ev?.[0]?.priority_tier ?? "fyi";
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
        <p className="text-sm text-muted-foreground">No hay insights pendientes de los agentes</p>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>
    );
  }

  const currentInsight = insights[currentIndex];

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 md:px-0 md:py-0 md:mb-6">
        <div>
          <h1 className="text-lg md:text-2xl font-bold">Inbox</h1>
          <p className="text-xs md:text-sm text-muted-foreground">{insights.length} insights pendientes de tus agentes</p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* MOBILE: Swipeable cards (hidden on md+)                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="md:hidden px-4 pb-24">
        {currentInsight && (
          <>
            {/* Card stack */}
            <div className="relative h-[420px]">
              {/* Background cards */}
              {insights[currentIndex + 2] && (
                <div className="absolute inset-x-2 top-4 h-full rounded-2xl border bg-card opacity-30 scale-[0.92]" />
              )}
              {insights[currentIndex + 1] && (
                <div className="absolute inset-x-1 top-2 h-full rounded-2xl border bg-card opacity-50 scale-[0.96]" />
              )}

              {/* Active card */}
              <div
                className="absolute inset-0 rounded-2xl border bg-card shadow-lg overflow-hidden transition-transform"
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
                            <Icon className={cn("h-4 w-4", DOMAIN_COLORS[agent?.domain ?? ""])} />
                            <span className="text-xs font-medium text-muted-foreground">{agent?.name ?? "Agente"}</span>
                          </>
                        );
                      })()}
                    </div>
                    {(() => {
                      const tier = getTier(currentInsight);
                      const cfg = TIER_LABELS[tier] ?? TIER_LABELS.fyi;
                      return <Badge className={cn("text-[10px]", cfg.color)}>{cfg.label}</Badge>;
                    })()}
                  </div>

                  {/* Severity + type */}
                  <div className="flex items-center gap-2 mb-2">
                    <SeverityBadge severity={currentInsight.severity} />
                    <Badge variant="outline" className="text-[10px]">{currentInsight.insight_type}</Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">{(currentInsight.confidence * 100).toFixed(0)}%</span>
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-bold leading-snug mb-2">{currentInsight.title}</h2>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1 overflow-y-auto">{currentInsight.description}</p>

                  {/* Recommendation */}
                  {currentInsight.recommendation && (
                    <div className="mt-3 rounded-lg bg-muted/50 p-3">
                      <p className="text-xs font-medium mb-1">Accion sugerida:</p>
                      <p className="text-sm">{currentInsight.recommendation}</p>
                    </div>
                  )}

                  {/* Impact */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span>{timeAgo(currentInsight.created_at)}</span>
                    {currentInsight.business_impact_estimate != null && currentInsight.business_impact_estimate > 0 && (
                      <span className="font-medium">${formatCurrency(currentInsight.business_impact_estimate)}</span>
                    )}
                    <span>{currentIndex + 1} / {insights.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-6 mt-6">
              <button
                onClick={() => dismissInsight(currentInsight.id)}
                className="flex flex-col items-center gap-1"
              >
                <div className="h-14 w-14 rounded-full border-2 border-red-300 flex items-center justify-center hover:bg-red-500/10 active:scale-95 transition-all">
                  <X className="h-6 w-6 text-red-500" />
                </div>
                <span className="text-[10px] text-muted-foreground">Descartar</span>
              </button>
              <button
                onClick={() => goToDetail(currentInsight.id)}
                className="flex flex-col items-center gap-1"
              >
                <div className="h-12 w-12 rounded-full border-2 border-blue-300 flex items-center justify-center hover:bg-blue-500/10 active:scale-95 transition-all">
                  <Eye className="h-5 w-5 text-blue-500" />
                </div>
                <span className="text-[10px] text-muted-foreground">Detalle</span>
              </button>
              <button
                onClick={() => actOnInsight(currentInsight.id)}
                className="flex flex-col items-center gap-1"
              >
                <div className="h-14 w-14 rounded-full border-2 border-emerald-300 flex items-center justify-center hover:bg-emerald-500/10 active:scale-95 transition-all">
                  <ThumbsUp className="h-6 w-6 text-emerald-500" />
                </div>
                <span className="text-[10px] text-muted-foreground">Util</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Professional list view (hidden on mobile)               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block space-y-2">
        {insights.map((insight) => {
          const agent = agents[insight.agent_id];
          const Icon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
          const tier = getTier(insight);
          const tierCfg = TIER_LABELS[tier] ?? TIER_LABELS.fyi;

          return (
            <Card
              key={insight.id}
              className={cn(
                "group cursor-pointer transition-all hover:border-primary/20 hover:shadow-sm",
                tier === "urgent" && "border-l-4 border-l-red-500",
                tier === "important" && "border-l-4 border-l-amber-500",
              )}
              onClick={() => goToDetail(insight.id)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  {/* Agent icon */}
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-full bg-muted shrink-0")}>
                    <Icon className={cn("h-5 w-5", DOMAIN_COLORS[agent?.domain ?? ""])} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge className={cn("text-[10px] px-1.5", tierCfg.color)}>{tierCfg.label}</Badge>
                      <SeverityBadge severity={insight.severity} />
                      <Badge variant="outline" className="text-[10px]">{insight.insight_type}</Badge>
                      <span className="text-[10px] text-muted-foreground">{agent?.name?.replace("Agente de ", "")}</span>
                    </div>
                    <h3 className="text-sm font-semibold truncate">{insight.title}</h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{insight.recommendation ?? insight.description}</p>
                  </div>

                  {/* Right side: metrics + actions */}
                  <div className="flex items-center gap-4 shrink-0">
                    {/* Confidence */}
                    <div className="text-center hidden lg:block">
                      <p className={cn(
                        "text-sm font-bold",
                        insight.confidence >= 0.85 ? "text-emerald-500" : insight.confidence >= 0.7 ? "text-amber-500" : "text-muted-foreground"
                      )}>
                        {(insight.confidence * 100).toFixed(0)}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">confianza</p>
                    </div>

                    {/* Impact */}
                    {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 && (
                      <div className="text-center hidden lg:block">
                        <p className="text-sm font-bold">${(insight.business_impact_estimate / 1000).toFixed(0)}K</p>
                        <p className="text-[10px] text-muted-foreground">impacto</p>
                      </div>
                    )}

                    {/* Time */}
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">{timeAgo(insight.created_at)}</p>
                    </div>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-emerald-500 hover:bg-emerald-500/10"
                        onClick={() => actOnInsight(insight.id)}
                        disabled={acting === insight.id}
                      >
                        {acting === insight.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        onClick={() => dismissInsight(insight.id)}
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
    </div>
  );
}
