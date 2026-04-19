"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePullRefresh } from "@/hooks/use-pull-refresh";

interface Props {
  children: React.ReactNode;
  /** Texto mostrado cuando está listo para soltar */
  releaseLabel?: string;
  /** Texto mostrado durante el refresh */
  refreshingLabel?: string;
  className?: string;
}

/**
 * PullToRefresh — wrapper cliente para mobile pull-to-refresh.
 * Llama a `router.refresh()` que re-ejecuta los Server Components.
 *
 * Ejemplo:
 *   <PullToRefresh>
 *     <main>{children}</main>
 *   </PullToRefresh>
 */
export function PullToRefresh({
  children,
  releaseLabel = "Suelta para actualizar",
  refreshingLabel = "Actualizando…",
  className,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRefresh = useCallback(async () => {
    await new Promise<void>((resolve) => {
      startTransition(() => {
        router.refresh();
        resolve();
      });
    });
  }, [router]);

  const { pulling, refreshing, distance } = usePullRefresh({
    threshold: 70,
    onRefresh: handleRefresh,
  });

  const ready = distance >= 70;
  const showing = pulling || refreshing || isPending;
  const translateY = showing
    ? Math.min(distance, 90) - (refreshing || isPending ? 0 : 0)
    : 0;

  return (
    <div className={cn("relative", className)}>
      {/* Pull indicator */}
      {showing && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-center"
          style={{
            transform: `translateY(${Math.max(translateY - 36, -36)}px)`,
            opacity: Math.min(1, distance / 70),
            transition: refreshing || isPending ? "transform 150ms" : undefined,
          }}
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] shadow-md">
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (refreshing || isPending) && "animate-spin",
                ready && !refreshing && !isPending && "rotate-180"
              )}
              aria-hidden
            />
            <span>
              {refreshing || isPending
                ? refreshingLabel
                : ready
                  ? releaseLabel
                  : "Tira para actualizar"}
            </span>
          </div>
        </div>
      )}

      <div
        style={{
          transform: pulling
            ? `translateY(${Math.min(distance * 0.5, 40)}px)`
            : undefined,
          transition: pulling ? undefined : "transform 200ms",
        }}
      >
        {children}
      </div>
    </div>
  );
}
