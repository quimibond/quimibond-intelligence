"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
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

const SEVERITY_DOTS: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-yellow-400",
};

export function InboxMobile({
  insights, agents, seenIds, acting, onAct, onDismiss, onDetail, onMarkSeen,
}: InboxMobileProps) {
  return (
    <div className="space-y-2 px-1">
      {insights.map((insight) => (
        <SwipeCard
          key={insight.id}
          insight={insight}
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

function SwipeCard({
  insight, isSeen, isActing, onAct, onDismiss, onDetail, onMarkSeen,
}: {
  insight: AgentInsight;
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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isScrolling.current = null;
    if (!isSeen) onMarkSeen();
  }, [isSeen, onMarkSeen]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (isScrolling.current === null) {
      isScrolling.current = Math.abs(dy) > Math.abs(dx);
    }
    if (isScrolling.current) return;
    e.preventDefault();
    setSwipeX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isScrolling.current) { isScrolling.current = null; return; }
    if (swipeX > 100) { setDismissed(true); setTimeout(onAct, 150); }
    else if (swipeX < -100) { setDismissed(true); setTimeout(onDismiss, 150); }
    setSwipeX(0);
    isScrolling.current = null;
  }, [swipeX, onAct, onDismiss]);

  if (dismissed) return null;

  const isSwipingRight = swipeX > 30;
  const isSwipingLeft = swipeX < -30;
  const swipeOpacity = Math.min(Math.abs(swipeX) / 120, 1);
  const sevDot = SEVERITY_DOTS[insight.severity ?? "medium"] ?? "bg-gray-400";

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe overlays */}
      {isSwipingRight && (
        <div className="absolute inset-0 bg-emerald-500/15 z-10 flex items-center pl-5" style={{ opacity: swipeOpacity }}>
          <span className="text-emerald-600 text-sm font-semibold">Util</span>
        </div>
      )}
      {isSwipingLeft && (
        <div className="absolute inset-0 bg-red-500/15 z-10 flex items-center justify-end pr-5" style={{ opacity: swipeOpacity }}>
          <span className="text-red-600 text-sm font-semibold">Descartar</span>
        </div>
      )}

      {/* Card */}
      <div
        className={cn(
          "relative bg-card border rounded-2xl p-4 active:bg-muted/50 transition-colors",
          !isSeen && "border-primary/20",
          isActing && "opacity-50",
        )}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? "transform 0.15s ease-out" : "none",
        }}
        onClick={() => onDetail()}
      >
        {/* Title with severity dot */}
        <div className="flex items-start gap-2.5 mb-1.5">
          <div className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", sevDot)} />
          <h3 className={cn("text-[15px] leading-snug", !isSeen ? "font-bold" : "font-medium")}>
            {insight.title}
          </h3>
        </div>

        {/* Recommendation / description */}
        {(insight.recommendation || insight.description) && (
          <p className="text-[13px] text-muted-foreground leading-snug ml-[18px] mb-2 line-clamp-2">
            {insight.recommendation ?? insight.description}
          </p>
        )}

        {/* Footer: time + detail arrow */}
        <div className="flex items-center justify-between ml-[18px]">
          <span className="text-[11px] text-muted-foreground">
            {timeAgo(insight.created_at)}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </div>
      </div>
    </div>
  );
}

export function computeTier(insight: AgentInsight): "urgent" | "important" | "fyi" {
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}
