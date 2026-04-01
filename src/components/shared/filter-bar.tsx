"use client";

import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  className?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  children,
  className,
}: FilterBarProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      <div className="relative flex-1 min-w-[200px] sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      {children && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {children}
        </div>
      )}
    </div>
  );
}
