"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionNavItem {
  /** id del elemento destino (sin `#`) */
  id: string;
  label: string;
  /** Conteo opcional al lado del label (ej: # de items en la sección) */
  count?: number | string;
}

interface SectionNavProps {
  items: SectionNavItem[];
  className?: string;
  /** Offset en pixels para ajustar scroll-margin-top (header height). Default: 96 */
  offset?: number;
}

/**
 * SectionNav — subnav sticky con pills que hacen smooth scroll a secciones
 * ancladas. Highlight automático del item activo vía IntersectionObserver.
 *
 * Uso:
 *   <SectionNav items={[
 *     { id: "risk", label: "Riesgo de pago" },
 *     { id: "aging", label: "Aging", count: 47 },
 *     { id: "overdue", label: "Vencidas" },
 *   ]} />
 *
 *   <section id="risk" className="scroll-mt-24">...</section>
 *   <section id="aging" className="scroll-mt-24">...</section>
 *   <section id="overdue" className="scroll-mt-24">...</section>
 */
export function SectionNav({ items, className, offset = 96 }: SectionNavProps) {
  const [activeId, setActiveId] = React.useState<string | null>(
    items[0]?.id ?? null
  );
  const navRef = React.useRef<HTMLDivElement>(null);

  // IntersectionObserver: highlight del item cuya sección está más visible.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const observers: IntersectionObserver[] = [];
    const visibility = new Map<string, number>();

    const recompute = () => {
      let bestId: string | null = null;
      let bestRatio = 0;
      for (const item of items) {
        const ratio = visibility.get(item.id) ?? 0;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = item.id;
        }
      }
      if (bestId && bestRatio > 0) setActiveId(bestId);
    };

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            visibility.set(item.id, entry.intersectionRatio);
          }
          recompute();
        },
        {
          rootMargin: `-${offset}px 0px -40% 0px`,
          threshold: [0, 0.25, 0.5, 0.75, 1],
        }
      );
      observer.observe(el);
      observers.push(observer);
    }

    return () => {
      for (const o of observers) o.disconnect();
    };
  }, [items, offset]);

  // Auto-scroll del pill activo hacia el centro del nav
  React.useEffect(() => {
    if (!activeId || !navRef.current) return;
    const btn = navRef.current.querySelector<HTMLAnchorElement>(
      `[data-section-id="${activeId}"]`
    );
    if (btn) {
      btn.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
    }
  }, [activeId]);

  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string
  ) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: "smooth" });
    setActiveId(id);
    // Update URL hash sin re-render
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  };

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6",
        "md:-mt-6 md:pt-3",
        className
      )}
      role="navigation"
      aria-label="Secciones de la página"
    >
      <div
        ref={navRef}
        className="flex gap-1.5 overflow-x-auto pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-section-id={item.id}
              aria-current={isActive ? "location" : undefined}
              onClick={(e) => handleClick(e, item.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span>{item.label}</span>
              {item.count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {item.count}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
