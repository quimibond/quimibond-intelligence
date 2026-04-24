"use client";

import { useState } from "react";
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
  PRESET_RANGES,
  PRESET_RANGE_LABEL,
  historyRangeLabel,
  isMonthRange,
  isYearRange,
  monthsBack,
  parseHistoryRange,
  yearsBack,
  type HistoryRange,
} from "./history-range";

// Re-export server-safe helpers
export { parseHistoryRange, type HistoryRange };

export interface HistorySelectorProps {
  paramName: string;
  defaultRange?: HistoryRange;
  className?: string;
  /** Primer mes disponible para picker (default "2024-01") */
  fromMonth?: string;
  /** Primer año disponible para picker (default 2024) */
  fromYear?: number;
}

type Tab = "preset" | "month" | "year";

export function HistorySelector({
  paramName,
  defaultRange = "ltm",
  className,
  fromMonth = "2024-01",
  fromYear = 2024,
}: HistorySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseHistoryRange(
    searchParams.get(paramName) ?? undefined,
    defaultRange
  );

  const [tab, setTab] = useState<Tab>(
    isMonthRange(current) ? "month" : isYearRange(current) ? "year" : "preset"
  );

  function apply(next: HistoryRange) {
    const p = new URLSearchParams(searchParams.toString());
    if (next === defaultRange) p.delete(paramName);
    else p.set(paramName, next);
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  const months = monthsBack(fromMonth);
  const years = yearsBack(fromYear);

  // Agrupa meses por año para display
  const monthsByYear = months.reduce<Record<string, typeof months>>(
    (acc, m) => {
      const yr = m.slice(2, 6);
      (acc[yr] ||= []).push(m);
      return acc;
    },
    {}
  );
  const orderedYears = Object.keys(monthsByYear).sort((a, b) => b.localeCompare(a));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1.5 text-xs font-medium", className)}
        >
          <CalendarRange className="h-3 w-3 opacity-70" aria-hidden />
          <span>{historyRangeLabel(current)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end">
        {/* Tabs */}
        <div className="flex border-b">
          {(["preset", "month", "year"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "preset" ? "Presets" : t === "month" ? "Mes" : "Año"}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="max-h-[280px] overflow-y-auto p-1">
          {tab === "preset" && (
            <>
              {PRESET_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => apply(r)}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    r === current && "bg-accent font-medium"
                  )}
                >
                  {PRESET_RANGE_LABEL[r]}
                </button>
              ))}
            </>
          )}

          {tab === "month" && (
            <div className="space-y-2 p-1">
              {orderedYears.map((yr) => (
                <div key={yr}>
                  <div className="px-1 pb-1 text-[10px] font-medium uppercase text-muted-foreground">
                    {yr}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {monthsByYear[yr].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => apply(m)}
                        className={cn(
                          "rounded px-1 py-1 text-center text-xs hover:bg-accent",
                          m === current && "bg-accent font-medium"
                        )}
                      >
                        {historyRangeLabel(m).split(" ")[0]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "year" && (
            <>
              {years.map((yr) => (
                <button
                  key={yr}
                  type="button"
                  onClick={() => apply(yr)}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    yr === current && "bg-accent font-medium"
                  )}
                >
                  {historyRangeLabel(yr)}
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
