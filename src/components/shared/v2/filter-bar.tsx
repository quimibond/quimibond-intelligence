"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface FilterOption<T extends string = string> {
  key: string;
  label: string;
  options: { value: T; label: string; count?: number }[];
  /** Valor actual seleccionado (o undefined para "todos") */
  value?: T;
}

interface FilterBarProps<T extends string = string> {
  filters: FilterOption<T>[];
  onChange: (key: string, value: T | undefined) => void;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * FilterBar — chips horizontales con scroll en mobile, wrap en desktop.
 * Touch targets 44px.
 */
export function FilterBar<T extends string = string>({
  filters,
  onChange,
  actions,
  className,
}: FilterBarProps<T>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {filters.map((filter) => (
          <div
            key={filter.key}
            className="flex shrink-0 items-center gap-1 sm:flex-wrap"
          >
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {filter.label}
            </span>
            <Button
              type="button"
              variant={filter.value === undefined ? "default" : "outline"}
              size="sm"
              className="h-9 min-h-[36px] rounded-full px-3 text-xs"
              onClick={() => onChange(filter.key, undefined)}
            >
              Todos
            </Button>
            {filter.options.map((opt) => {
              const active = filter.value === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="h-9 min-h-[36px] shrink-0 rounded-full px-3 text-xs"
                  onClick={() => onChange(filter.key, active ? undefined : opt.value)}
                >
                  {opt.label}
                  {opt.count != null && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-4 px-1 text-[10px]"
                    >
                      {opt.count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
