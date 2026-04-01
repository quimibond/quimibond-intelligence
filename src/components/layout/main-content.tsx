"use client";

import { usePathname } from "next/navigation";
import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();

  // Login page: no sidebar padding, no mobile top padding
  if (pathname === "/login") {
    return <main id="main-content">{children}</main>;
  }

  return (
    <main
      id="main-content"
      className={cn(
        "transition-[padding-left] duration-200",
        collapsed ? "md:pl-16" : "md:pl-64"
      )}
    >
      <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">{children}</div>
    </main>
  );
}
