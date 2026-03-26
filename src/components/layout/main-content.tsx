"use client";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <main
      className={cn(
        "transition-[padding-left] duration-200",
        collapsed ? "md:pl-16" : "md:pl-64"
      )}
    >
      <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">{children}</div>
    </main>
  );
}
