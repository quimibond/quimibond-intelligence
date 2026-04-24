"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  HISTORY_RANGES,
  HISTORY_RANGE_LABEL,
  parseHistoryRange,
  type HistoryRange,
} from "./history-range";

// Re-export server-safe helpers so existing callers don't break.
export { parseHistoryRange, type HistoryRange };

export interface HistorySelectorProps {
  paramName: string;
  defaultRange?: HistoryRange;
  className?: string;
}

export function HistorySelector({
  paramName,
  defaultRange = "ltm",
  className,
}: HistorySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseHistoryRange(
    searchParams.get(paramName) ?? undefined,
    defaultRange
  );

  function apply(next: HistoryRange) {
    const p = new URLSearchParams(searchParams.toString());
    if (next === defaultRange) p.delete(paramName);
    else p.set(paramName, next);
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1.5 text-xs font-medium", className)}
        >
          <CalendarRange className="h-3 w-3 opacity-70" aria-hidden />
          <span>{HISTORY_RANGE_LABEL[current]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => apply(r)}
            className={cn(
              "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
              r === current && "bg-accent font-medium"
            )}
          >
            {HISTORY_RANGE_LABEL[r]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
