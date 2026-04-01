"use client";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 pb-4 sm:pb-6", className)}>
      <div className="space-y-0.5 sm:space-y-1 min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{title}</h1>
        {description && (
          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">{children}</div>
      )}
    </div>
  );
}
