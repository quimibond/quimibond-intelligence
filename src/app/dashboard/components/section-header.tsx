"use client";

import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  title: string;
  icon: React.ElementType;
  color: string;
}

export function SectionHeader({ title, icon: Icon, color }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className={cn("h-4 w-4", color)} />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="flex-1 border-b" />
    </div>
  );
}
