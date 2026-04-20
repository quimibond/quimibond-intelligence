"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
export type YearValue = number | "all";

// ──────────────────────────────────────────────────────────────────────────
// Helpers (also usable on the server side for parsing)
// ──────────────────────────────────────────────────────────────────────────

/** Parse a raw URL param string into a YearValue. */
export function parseYearParam(
  raw: string | string[] | undefined
): YearValue | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return undefined;
  if (v === "all") return "all";
  const n = Number(v);
  if (!Number.isNaN(n) && n > 2000 && n < 2100) return n;
  return undefined;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS: YearValue[] = ["all", CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function yearLabel(y: YearValue): string {
  return y === "all" ? "Todos los años" : String(y);
}

function yearShortLabel(y: YearValue | undefined): string {
  if (!y) return String(CURRENT_YEAR);
  return y === "all" ? "Todos" : String(y);
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────
/**
 * @deprecated Fase 1.8 — use `PeriodSelector` instead (richer filter with
 * presets + quarter/month granularity). This component will be removed
 * once the migration settles. See `src/components/patterns/period-selector.tsx`.
 */
export interface YearSelectorProps {
  /** URL search param name (default "year"). Use unique prefixed names per section, e.g. "inv_year". */
  paramName?: string;
  /** Optional label prefix shown before the selected year */
  label?: string;
  /** Custom class for the trigger button */
  className?: string;
}

export function YearSelector({
  paramName = "year",
  label,
  className,
}: YearSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get(paramName) ?? undefined;
  const current = parseYearParam(raw) ?? CURRENT_YEAR;

  function selectYear(y: YearValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (y === CURRENT_YEAR) {
      // Default year — clean from URL to keep it tidy
      params.delete(paramName);
    } else {
      params.set(paramName, String(y));
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 text-xs font-medium ${className ?? ""}`}
        >
          {label ? `${label}: ` : ""}
          {yearShortLabel(current)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {YEAR_OPTIONS.map((y) => (
          <DropdownMenuItem
            key={String(y)}
            onClick={() => selectYear(y)}
            className={current === y ? "font-semibold" : ""}
          >
            {yearLabel(y)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
