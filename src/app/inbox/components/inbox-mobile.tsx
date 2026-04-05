"use client";

import { useCallback, useRef, useState } from "react";
import {
  ArrowRight, CheckCircle, Lightbulb, XCircle,
} from "lucide-react";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_COLORS } from "@/lib/constants";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentInsight } from "@/lib/types";

// ── Helpers ──

function computeTier(insight: AgentInsight): "urgent" | "important" | "fyi" {
  const ev = insight.evidence as { priority_tier?: string }[] | null;
  const evTier = ev?.[0]?.priority_tier;
  if (evTier === "urgent" || evTier === "important") return evTier;
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}

const TIER_STYLES = {
  urgent: { label: "URGENTE", pill: "bg-danger text-destructive-foreground", stripe: "bg-danger" },
  important: { label: "IMPORTANTE", pill: "bg-warning text-warning-foreground", stripe: "bg-warning" },
  fyi: { label: "FYI", pill: "bg-muted text-muted-foreground", stripe: "bg-muted-foreground/30" },
} as const;

const SWIPE_THRESHOLD = 80;
const SWIPE_UP_THRESHOLD = 60;

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
  const [swipeY, setSwipeY] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"horizontal" | "vertical" | null>(null);
  const [showHint, setShowHint] = useState(true);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const isActingRef = useRef(false);

  const safeIndex = Math.min(currentIndex, Math.max(0, insights.length - 1));
  const currentInsight = insights[safeIndex];

  // Dismiss hint after first swipe
  const dismissHint = useCallback(() => {
    if (showHint) setShowHint(false);
  }, [showHint]);

  // ── Swipe handlers ──

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isActingRef.current) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    setSwipeDirection(null);
    setIsSwiping(false);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isActingRef.current) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;

    // Determine direction on first significant move
    if (!swipeDirection) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        setSwipeDirection("horizontal");
      } else if (Math.abs(dy) > 10 && dy < 0 && Math.abs(dy) > Math.abs(dx)) {
        setSwipeDirection("vertical"); // only swipe UP
      } else {
        return;
      }
    }

    if (swipeDirection === "horizontal") {
      setSwipeX(dx);
      setIsSwiping(true);
      dismissHint();
    } else if (swipeDirection === "vertical" && dy < 0) {
      setSwipeY(dy);
      setIsSwiping(true);
      dismissHint();
    }
  }, [swipeDirection, dismissHint]);

  const onTouchEnd = useCallback(() => {
    if (!isSwiping || !currentInsight || isActingRef.current) {
      setSwipeX(0);
      setSwipeY(0);
      setIsSwiping(false);
      setSwipeDirection(null);
      return;
    }

    isActingRef.current = true;

    if (swipeDirection === "horizontal") {
      if (swipeX > SWIPE_THRESHOLD) {
        onAct(currentInsight.id);
      } else if (swipeX < -SWIPE_THRESHOLD) {
        onDismiss(currentInsight.id);
      }
    } else if (swipeDirection === "vertical" && swipeY < -SWIPE_UP_THRESHOLD) {
      onDetail(currentInsight.id);
    }

    // Reset after a short delay to prevent double-actions
    setTimeout(() => { isActingRef.current = false; }, 300);
    setSwipeX(0);
    setSwipeY(0);
    setIsSwiping(false);
    setSwipeDirection(null);
  }, [swipeX, swipeY, swipeDirection, isSwiping, currentInsight, onAct, onDismiss, onDetail]);

  // Auto-advance when insight is removed
  const prevLength = useRef(insights.length);
  if (insights.length < prevLength.current && currentIndex >= insights.length) {
    setCurrentIndex(Math.max(0, insights.length - 1));
  }
  prevLength.current = insights.length;

  if (!currentInsight) return null;

  const agent = agents[currentInsight.agent_id];
  const dc = getDomainConfig(agent?.domain ?? "");
  const AgentIcon = dc.icon;
  const tier = computeTier(currentInsight);
  const tierStyle = TIER_STYLES[tier];
  const isNew = !seenIds.has(currentInsight.id);
  const isProcessing = acting === currentInsight.id;

  // Swipe visual feedback
  const swipeOpacity = Math.min(1, Math.abs(swipeX) / SWIPE_THRESHOLD);
  const swipeUpOpacity = Math.min(1, Math.abs(swipeY) / SWIPE_UP_THRESHOLD);
  const cardTransform = isSwiping
    ? swipeDirection === "horizontal"
      ? `translateX(${swipeX}px) rotate(${swipeX * 0.04}deg)`
      : `translateY(${swipeY}px) scale(${1 - Math.abs(swipeY) * 0.001})`
    : "none";

  return (
    <div className="px-4 pb-6">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 mb-4">
        {insights.slice(Math.max(0, safeIndex - 3), safeIndex + 4).map((ins, i) => {
          const realIndex = Math.max(0, safeIndex - 3) + i;
          return (
            <div
              key={ins.id}
              className={cn(
                "rounded-full transition-all duration-200",
                realIndex === safeIndex
                  ? "w-6 h-2 bg-foreground"
                  : "w-2 h-2 bg-muted-foreground/30"
              )}
            />
          );
        })}
        <span className="text-[10px] text-muted-foreground ml-2 tabular-nums">
          {safeIndex + 1}/{insights.length}
        </span>
      </div>

      {/* Card stack */}
      <div className="relative" style={{ minHeight: "min(70vh, 520px)" }}>
        {/* Background cards for stack effect */}
        {insights[safeIndex + 2] && (
          <div className="absolute inset-x-3 top-3 bottom-0 rounded-2xl border bg-card opacity-20 scale-[0.94]" />
        )}
        {insights[safeIndex + 1] && (
          <div className="absolute inset-x-1.5 top-1.5 bottom-0 rounded-2xl border bg-card opacity-40 scale-[0.97]" />
        )}

        {/* Active card */}
        <div
          className={cn(
            "relative rounded-2xl border bg-card shadow-lg overflow-hidden transition-transform duration-150",
            isNew && "ring-2 ring-primary/20",
            isProcessing && "opacity-50 pointer-events-none"
          )}
          style={{ transform: cardTransform, minHeight: "min(70vh, 520px)" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Tier stripe at top */}
          <div className={cn("h-1 w-full", tierStyle.stripe)} />

          {/* Swipe overlays */}
          {swipeX > 20 && (
            <div
              className="absolute inset-0 bg-success/10 pointer-events-none flex flex-col items-center justify-center gap-2 z-10"
              style={{ opacity: swipeOpacity }}
            >
              <CheckCircle className="h-14 w-14 text-success" />
              <span className="text-sm font-semibold text-success">Util</span>
            </div>
          )}
          {swipeX < -20 && (
            <div
              className="absolute inset-0 bg-danger/10 pointer-events-none flex flex-col items-center justify-center gap-2 z-10"
              style={{ opacity: swipeOpacity }}
            >
              <XCircle className="h-14 w-14 text-danger" />
              <span className="text-sm font-semibold text-danger">Descartar</span>
            </div>
          )}
          {swipeY < -15 && swipeDirection === "vertical" && (
            <div
              className="absolute inset-0 bg-info/10 pointer-events-none flex flex-col items-center justify-center gap-2 z-10"
              style={{ opacity: swipeUpOpacity }}
            >
              <ArrowRight className="h-14 w-14 text-info -rotate-90" />
              <span className="text-sm font-semibold text-info">Ver detalle</span>
            </div>
          )}

          {/* Card content */}
          <div className="p-5 flex flex-col" style={{ minHeight: "calc(min(70vh, 520px) - 4px)" }}>
            {/* Header: agent + tier */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", dc.bg)}>
                  <AgentIcon className={cn("h-4 w-4", dc.color)} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {agent?.name?.replace("Director de ", "Dir. ").replace("Director ", "Dir. ") ?? "Agente"}
                </span>
              </div>
              <Badge className={cn("text-[10px] font-bold", tierStyle.pill)}>{tierStyle.label}</Badge>
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <SeverityBadge severity={currentInsight.severity ?? "medium"} />
              {currentInsight.category && (
                <span className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                  INSIGHT_CATEGORY_COLORS[currentInsight.category] ?? "text-gray-600 bg-gray-50"
                )}>
                  {INSIGHT_CATEGORY_LABELS[currentInsight.category] ?? currentInsight.category}
                </span>
              )}
              {currentInsight.assignee_name && (
                <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">
                  → {currentInsight.assignee_name}
                </span>
              )}
            </div>

            {/* Title */}
            <h2 className="text-lg font-bold leading-tight mb-3">{currentInsight.title}</h2>

            {/* Description — scrollable area */}
            <div className="flex-1 overflow-y-auto mb-3 -mx-1 px-1">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {currentInsight.description}
              </p>
            </div>

            {/* Recommendation */}
            {currentInsight.recommendation && (
              <div className="rounded-xl bg-success/5 border border-success/20 p-3 mb-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Lightbulb className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs font-semibold text-success-foreground">Accion sugerida</span>
                </div>
                <p className="text-sm leading-snug">{currentInsight.recommendation}</p>
              </div>
            )}

            {/* Footer: impact + confidence + time */}
            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-[11px] text-muted-foreground">{timeAgo(currentInsight.created_at)}</span>
              <div className="flex items-center gap-3">
                {currentInsight.business_impact_estimate != null && currentInsight.business_impact_estimate > 0 && (
                  <span className="text-xs font-bold text-foreground">{formatCurrency(currentInsight.business_impact_estimate)}</span>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-10 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (currentInsight.confidence ?? 0) >= 0.85 ? "bg-success" :
                        (currentInsight.confidence ?? 0) >= 0.7 ? "bg-warning" : "bg-muted-foreground"
                      )}
                      style={{ width: `${(currentInsight.confidence ?? 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {((currentInsight.confidence ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Swipe hint — shown once, dismissed on first interaction */}
      {showHint && (
        <div className="mt-4 text-center space-y-1 animate-pulse">
          <p className="text-xs text-muted-foreground">
            ← Desliza para descartar · Desliza para marcar util →
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            ↑ Desliza arriba para ver detalle
          </p>
        </div>
      )}

      {/* Action buttons — simplified: only 3 primary actions */}
      {!showHint && (
        <div className="flex items-center justify-center gap-6 mt-5">
          <button
            onClick={() => onDismiss(currentInsight.id)}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1.5 group"
            aria-label="Descartar insight"
          >
            <div className="h-14 w-14 rounded-full border-2 border-danger/30 flex items-center justify-center group-active:scale-90 group-active:bg-danger/10 transition-all">
              <XCircle className="h-6 w-6 text-danger" />
            </div>
            <span className="text-[10px] text-muted-foreground">Descartar</span>
          </button>

          <button
            onClick={() => onDetail(currentInsight.id)}
            className="flex flex-col items-center gap-1.5 group"
            aria-label="Ver detalle del insight"
          >
            <div className="h-12 w-12 rounded-full border-2 border-border flex items-center justify-center group-active:scale-90 group-active:bg-muted transition-all">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-[10px] text-muted-foreground">Detalle</span>
          </button>

          <button
            onClick={() => onAct(currentInsight.id)}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1.5 group"
            aria-label="Marcar insight como util"
          >
            <div className="h-14 w-14 rounded-full border-2 border-success/30 flex items-center justify-center group-active:scale-90 group-active:bg-success/10 transition-all">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <span className="text-[10px] text-muted-foreground">Util</span>
          </button>
        </div>
      )}
    </div>
  );
}
