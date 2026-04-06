"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp, CheckCircle, ChevronRight, XCircle,
} from "lucide-react";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_COLORS } from "@/lib/constants";
import { SeverityBadge } from "@/components/shared/severity-badge";
import type { AgentInsight } from "@/lib/types";

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
  return (
    <div className="space-y-3 px-1">
      {insights.map((insight) => (
        <SwipeCard
          key={insight.id}
          insight={insight}
          agent={agents[insight.agent_id]}
          isSeen={seenIds.has(insight.id)}
          isActing={acting === insight.id}
          onAct={() => onAct(insight.id)}
          onDismiss={() => onDismiss(insight.id)}
          onDetail={() => onDetail(insight.id)}
          onMarkSeen={() => onMarkSeen(insight.id)}
        />
      ))}
    </div>
  );
}

// ── Individual Swipeable Card ──

function SwipeCard({
  insight,
  agent,
  isSeen,
  isActing,
  onAct,
  onDismiss,
  onDetail,
  onMarkSeen,
}: {
  insight: AgentInsight;
  agent?: { slug: string; name: string; domain: string };
  isSeen: boolean;
  isActing: boolean;
  onAct: () => void;
  onDismiss: () => void;
  onDetail: () => void;
  onMarkSeen: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isScrolling = useRef<boolean | null>(null);

  const dc = getDomainConfig(agent?.domain ?? "");
  const Icon = dc.icon;
  const directorName = agent?.name?.replace("Director de ", "").replace("Director ", "") ?? "";

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isScrolling.current = null;
    if (!isSeen) onMarkSeen();
  }, [isSeen, onMarkSeen]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Determine if scrolling vertically (don't hijack scroll)
    if (isScrolling.current === null) {
      isScrolling.current = Math.abs(dy) > Math.abs(dx);
    }
    if (isScrolling.current) return;

    e.preventDefault();
    setSwipeX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isScrolling.current) {
      isScrolling.current = null;
      return;
    }

    if (swipeX > 100) {
      setDismissed(true);
      setTimeout(onAct, 200);
    } else if (swipeX < -100) {
      setDismissed(true);
      setTimeout(onDismiss, 200);
    }
    setSwipeX(0);
    isScrolling.current = null;
  }, [swipeX, onAct, onDismiss]);

  if (dismissed) return null;

  // Swipe visual feedback
  const isSwipingRight = swipeX > 40;
  const isSwipingLeft = swipeX < -40;
  const swipeOpacity = Math.min(Math.abs(swipeX) / 120, 1);

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe action overlays */}
      {isSwipingRight && (
        <div
          className="absolute inset-0 bg-emerald-500/20 z-10 flex items-center justify-start pl-6"
          style={{ opacity: swipeOpacity }}
        >
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle className="h-8 w-8" />
            <span className="text-sm font-bold">Util</span>
          </div>
        </div>
      )}
      {isSwipingLeft && (
        <div
          className="absolute inset-0 bg-red-500/20 z-10 flex items-center justify-end pr-6"
          style={{ opacity: swipeOpacity }}
        >
          <div className="flex items-center gap-2 text-red-600">
            <span className="text-sm font-bold">Descartar</span>
            <XCircle className="h-8 w-8" />
          </div>
        </div>
      )}

      {/* Card */}
      <div
        className={cn(
          "relative bg-card border border-border rounded-2xl p-4 transition-colors",
          !isSeen && "border-primary/30 bg-accent/30",
          isActing && "opacity-50",
        )}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? "transform 0.2s ease-out" : "none",
        }}
      >
        {/* Top row: severity + category + time */}
        <div className="flex items-center gap-1.5 mb-2">
          <div className={cn("flex h-6 w-6 items-center justify-center rounded-md shrink-0", dc.bg)}>
            <Icon className={cn("h-3.5 w-3.5", dc.color)} />
          </div>
          <SeverityBadge severity={insight.severity ?? "medium"} />
          {insight.category && (
            <span className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
              INSIGHT_CATEGORY_COLORS[insight.category] ?? "text-gray-600 bg-gray-50"
            )}>
              {INSIGHT_CATEGORY_LABELS[insight.category] ?? insight.category}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {timeAgo(insight.created_at)}
          </span>
        </div>

        {/* Title */}
        <h3 className={cn("text-sm leading-snug mb-1.5", !isSeen ? "font-bold" : "font-medium")}>
          {insight.title}
        </h3>

        {/* Description (truncated) */}
        {insight.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {insight.description}
          </p>
        )}

        {/* Bottom row: assignee + impact + detail button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {insight.assignee_name && (
              <span className="truncate max-w-[120px]">→ {insight.assignee_name}</span>
            )}
            {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 && (
              <span className="font-medium text-foreground">
                {formatCurrency(insight.business_impact_estimate)}
              </span>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDetail(); }}
            className="flex items-center gap-0.5 text-xs text-primary font-medium"
          >
            Ver <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Unread indicator */}
        {!isSeen && (
          <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
        )}
      </div>
    </div>
  );
}

export function computeTier(insight: AgentInsight): "urgent" | "important" | "fyi" {
  const ev = insight.evidence as { priority_tier?: string }[] | null;
  const evTier = ev?.[0]?.priority_tier;
  if (evTier === "urgent" || evTier === "important") return evTier;
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}
