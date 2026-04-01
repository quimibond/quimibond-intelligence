"use client";

import { useCallback, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Eye, ThumbsUp, X,
} from "lucide-react";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import type { AgentInsight } from "@/lib/types";

// ── Helpers ──

function computeTier(insight: AgentInsight): string {
  const ev = insight.evidence as { priority_tier?: string }[] | null;
  const evTier = ev?.[0]?.priority_tier ?? "fyi";
  if (evTier !== "fyi") return evTier;
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  urgent: { label: "URGENTE", color: "bg-danger text-destructive-foreground" },
  important: { label: "IMPORTANTE", color: "bg-warning text-warning-foreground" },
  fyi: { label: "FYI", color: "bg-info/20 text-info-foreground" },
};

// ── Props ──

interface InboxMobileProps {
  insights: AgentInsight[];
  agents: Record<number, { slug: string; name: string; domain: string }>;
  seenIds: Set<number>;
  acting: number | null;
  onAct: (id: number) => void;
  onDismiss: (id: number) => void;
  onDetail: (id: number) => void;
  onMarkSeen: (id: number) => void;
}

export function InboxMobile({
  insights,
  agents,
  seenIds,
  acting,
  onAct,
  onDismiss,
  onDetail,
  onMarkSeen,
}: InboxMobileProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const isHorizontalRef = useRef(false);

  const safeIndex = Math.min(currentIndex, Math.max(0, insights.length - 1));
  const currentInsight = insights[safeIndex];

  // ── Swipe handlers ──

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
      onAct(currentInsight.id);
    } else if (swipeX < -100) {
      onDismiss(currentInsight.id);
    }
    setSwipeX(0);
    setIsSwiping(false);
  }, [swipeX, isSwiping, currentInsight, onAct, onDismiss]);

  const goNextCard = useCallback(() => {
    if (safeIndex < insights.length - 1) {
      if (currentInsight) onMarkSeen(currentInsight.id);
      setCurrentIndex(safeIndex + 1);
    }
  }, [safeIndex, insights.length, currentInsight, onMarkSeen]);

  const goPrevCard = useCallback(() => {
    if (safeIndex > 0) setCurrentIndex(safeIndex - 1);
  }, [safeIndex]);

  if (!currentInsight) return null;

  return (
    <div className="md:hidden px-4 pb-24">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground/30 rounded-full transition-all"
            style={{ width: `${((safeIndex + 1) / insights.length) * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{safeIndex + 1}/{insights.length}</span>
      </div>

      {/* Card stack */}
      <div className="relative h-[420px]">
        {/* Background cards */}
        {insights[safeIndex + 2] && (
          <div className="absolute inset-x-2 top-4 h-full rounded-2xl border bg-card opacity-30 scale-[0.92]" />
        )}
        {insights[safeIndex + 1] && (
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
                  const dc = getDomainConfig(agent?.domain ?? "");
                  const Icon = dc.icon;
                  return (
                    <>
                      <div className={cn("flex h-6 w-6 items-center justify-center rounded-full", dc.bg)}>
                        <Icon className={cn("h-3.5 w-3.5", dc.color)} />
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
              <SeverityBadge severity={currentInsight.severity ?? "info"} />
              <Badge variant="outline" className="text-[10px]">{currentInsight.insight_type}</Badge>
              {currentInsight.assignee_name && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  &rarr; {currentInsight.assignee_name}
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

            {/* Impact + time + confidence */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-muted-foreground">
              <span>{timeAgo(currentInsight.created_at)}</span>
              <div className="flex items-center gap-3">
                {currentInsight.business_impact_estimate != null && currentInsight.business_impact_estimate > 0 && (
                  <span className="font-semibold text-foreground">{formatCurrency(currentInsight.business_impact_estimate)}</span>
                )}
                <span className="tabular-nums">{((currentInsight.confidence ?? 0) * 100).toFixed(0)}% confianza</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-4 mt-6">
        <button
          onClick={() => onDismiss(currentInsight.id)}
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
          onClick={() => onDetail(currentInsight.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className="h-12 w-12 rounded-full border-2 border-info/40 flex items-center justify-center hover:bg-info/10 active:scale-95 transition-all">
            <Eye className="h-5 w-5 text-info" />
          </div>
          <span className="text-[10px] text-muted-foreground">Detalle</span>
        </button>

        {/* Navigation: next */}
        <button
          onClick={goNextCard}
          disabled={safeIndex >= insights.length - 1}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            "h-10 w-10 rounded-full border-2 border-border flex items-center justify-center transition-all",
            safeIndex >= insights.length - 1 ? "opacity-30" : "hover:bg-muted active:scale-95"
          )}>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>

        <button
          onClick={() => onAct(currentInsight.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className="h-14 w-14 rounded-full border-2 border-success/40 flex items-center justify-center hover:bg-success/10 active:scale-95 transition-all">
            <ThumbsUp className="h-6 w-6 text-success" />
          </div>
          <span className="text-[10px] text-muted-foreground">Util</span>
        </button>
      </div>
    </div>
  );
}
