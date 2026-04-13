"use client";

import { useEffect, useRef, useState } from "react";

interface UsePullRefreshOptions {
  /** Distance en px que el usuario debe tirar antes de dispararse */
  threshold?: number;
  /** Callback asíncrono — se muestra spinner hasta que resuelva */
  onRefresh: () => Promise<void> | void;
  /** Deshabilitar en desktop */
  enabledOnDesktop?: boolean;
}

/**
 * usePullRefresh — pull-to-refresh nativo para páginas mobile.
 * Solo se activa cuando el scroll está en el tope del document.
 */
export function usePullRefresh({
  threshold = 70,
  onRefresh,
  enabledOnDesktop = false,
}: UsePullRefreshOptions) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [distance, setDistance] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!enabledOnDesktop && window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY === 0) {
        setPulling(true);
        setDistance(Math.min(dy, threshold * 1.5));
      }
    };

    const onTouchEnd = async () => {
      if (pulling && distance >= threshold && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
      startY.current = null;
      setPulling(false);
      setDistance(0);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [pulling, distance, threshold, onRefresh, refreshing, enabledOnDesktop]);

  return { pulling, refreshing, distance };
}
