"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MetricDefinition } from "@/lib/kpi";

export interface MetricTooltipProps {
  definition: MetricDefinition;
  children: React.ReactNode;
}

/**
 * Wraps a label or heading with a clickable info icon that opens a popover
 * containing the metric's definition, formula, source table, and optional
 * example. Every KPI heading should be wrapped.
 */
export function MetricTooltip({ definition, children }: MetricTooltipProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Qué significa: ${definition.title}`}
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Info className="size-3" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2 p-3 text-xs" align="start">
          <div className="font-semibold">{definition.title}</div>
          <p className="text-muted-foreground">{definition.description}</p>
          <div className="pt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Fórmula
            </div>
            <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
              {definition.formula}
            </code>
          </div>
          <div className="pt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Fuente
            </div>
            <code className="font-mono text-[11px]">{definition.table}</code>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
