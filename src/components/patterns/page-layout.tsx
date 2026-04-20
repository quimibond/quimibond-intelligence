import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * Canonical page wrapper. Use at the top of every page.tsx.
 *
 * NOTE: MainContent (src/components/layout/main-content.tsx) already renders
 * `<main id="main-content">` with responsive padding and sidebar offset.
 * PageLayout is a content-level `<div>` wrapper that adds consistent vertical
 * spacing between page sections + mobile tab-bar bottom clearance.
 */
export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <div className={cn("space-y-6 pb-24 md:pb-6", className)}>
      {children}
    </div>
  );
}
