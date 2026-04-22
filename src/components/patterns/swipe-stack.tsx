import * as React from "react";
import { cn } from "@/lib/utils";

interface SwipeStackProps {
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
  /** When false, disables snap behavior (useful for desktop > md:). Default true. */
  snap?: boolean;
}

/**
 * Vertical scroll-snap stack. Pure CSS (no JS gesture lib). On mobile (<md)
 * snap-mandatory + snap-center gives a Tinder-like card-per-screen feel.
 * On md+ consumers typically turn `snap={false}` and use a grid layout instead.
 */
export function SwipeStack({ ariaLabel, className, children, snap = true }: SwipeStackProps) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-180px)]",
        snap && "snap-y snap-mandatory",
        className
      )}
    >
      {React.Children.map(children, (child, i) => (
        <div
          data-swipe-item
          role="listitem"
          key={i}
          className={cn(snap && "snap-center shrink-0")}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
