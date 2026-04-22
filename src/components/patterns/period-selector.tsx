"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  DEFAULT_PERIOD,
  parsePeriod,
  periodLabel,
  serializePeriod,
  type PeriodPreset,
  type PeriodValue,
} from "@/lib/queries/_shared/period-filter";

export interface PeriodSelectorProps {
  /**
   * URL search param name. Use unique prefixed names per section, e.g.
   * "pr_period", "inv_period", "rev_period".
   */
  paramName?: string;
  /** Label prefix shown before the selected period. */
  label?: string;
  /** Minimum year offered in the "Año" grid. */
  minYear?: number;
  className?: string;
}

const PRESETS: readonly PeriodPreset[] = [
  "this-year",
  "last-year",
  "this-quarter",
  "this-month",
  "this-week",
  "today",
  "last-7d",
  "last-30d",
  "last-90d",
  "last-12m",
  "all",
];

const MONTHS: ReadonlyArray<{ num: number; label: string }> = [
  { num: 1, label: "Enero" },
  { num: 2, label: "Febrero" },
  { num: 3, label: "Marzo" },
  { num: 4, label: "Abril" },
  { num: 5, label: "Mayo" },
  { num: 6, label: "Junio" },
  { num: 7, label: "Julio" },
  { num: 8, label: "Agosto" },
  { num: 9, label: "Septiembre" },
  { num: 10, label: "Octubre" },
  { num: 11, label: "Noviembre" },
  { num: 12, label: "Diciembre" },
];

export function PeriodSelector({
  paramName = "period",
  label = "Período",
  minYear = 2019,
  className,
}: PeriodSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const current = parsePeriod(searchParams.get(paramName) ?? undefined);

  function apply(value: PeriodValue) {
    const params = new URLSearchParams(searchParams.toString());
    // `this-year` is the default → strip from URL to keep it clean.
    if (value.kind === "preset" && value.preset === "this-year") {
      params.delete(paramName);
    } else {
      params.set(paramName, serializePeriod(value));
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
    setOpen(false);
  }

  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let yr = currentYear; yr >= minYear; yr--) years.push(yr);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1.5 text-xs font-medium ${className ?? ""}`}
        >
          <CalendarIcon className="h-3 w-3 opacity-70" />
          <span>
            {label}: {periodLabel(current)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(460px,calc(100vw-1rem))] p-0" align="end">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] sm:divide-x max-h-[440px] overflow-y-auto">
          {/* Col 1 — Presets */}
          <div className="p-2 overflow-y-auto">
            <div className="text-xs font-semibold text-muted-foreground px-2 py-1">
              Presets
            </div>
            {PRESETS.map((p) => {
              const isActive =
                current.kind === "preset" && current.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => apply({ kind: "preset", preset: p })}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent ${
                    isActive ? "bg-accent font-medium" : ""
                  }`}
                >
                  {periodLabel({ kind: "preset", preset: p })}
                </button>
              );
            })}
          </div>

          {/* Col 2 — Años / Trimestres / Meses */}
          <div className="p-2 overflow-y-auto">
            <div className="text-xs font-semibold text-muted-foreground px-2 py-1">
              Año
            </div>
            <div className="grid grid-cols-3 gap-1 mb-2">
              {years.slice(0, 9).map((yr) => {
                const isActive =
                  current.kind === "year" && current.year === yr;
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => apply({ kind: "year", year: yr })}
                    className={`text-sm px-2 py-1.5 rounded hover:bg-accent ${
                      isActive ? "bg-accent font-medium" : ""
                    }`}
                  >
                    {yr}
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-semibold text-muted-foreground px-2 py-1">
              Trimestre ({currentYear})
            </div>
            <div className="grid grid-cols-4 gap-1 mb-2">
              {([1, 2, 3, 4] as const).map((q) => {
                const isActive =
                  current.kind === "quarter" &&
                  current.quarter === q &&
                  current.year === currentYear;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() =>
                      apply({
                        kind: "quarter",
                        year: currentYear,
                        quarter: q,
                      })
                    }
                    className={`text-sm px-2 py-1.5 rounded hover:bg-accent ${
                      isActive ? "bg-accent font-medium" : ""
                    }`}
                  >
                    Q{q}
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-semibold text-muted-foreground px-2 py-1">
              Mes ({currentYear})
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((m) => {
                const isActive =
                  current.kind === "month" &&
                  current.month === m.num &&
                  current.year === currentYear;
                return (
                  <button
                    key={m.num}
                    type="button"
                    onClick={() =>
                      apply({
                        kind: "month",
                        year: currentYear,
                        month: m.num,
                      })
                    }
                    className={`text-xs px-2 py-1.5 rounded hover:bg-accent ${
                      isActive ? "bg-accent font-medium" : ""
                    }`}
                  >
                    {m.label.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Actual: {periodLabel(current)}</span>
          <button
            type="button"
            onClick={() => apply(DEFAULT_PERIOD)}
            className="text-xs underline underline-offset-2 hover:text-foreground"
          >
            Reset
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
