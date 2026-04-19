import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <main
      id="main-content"
      className={cn("max-w-7xl mx-auto px-6 py-8 space-y-6", className)}
    >
      {children}
    </main>
  );
}
