import { type YearValue } from "@/components/patterns/year-selector";

/**
 * Given a YearValue, return a date range [from, to] (ISO strings YYYY-MM-DD)
 * suitable for passing into query functions.
 *
 * - undefined / number → year boundaries
 * - "all" → undefined (no filter)
 */
export function yearToDateRange(year: YearValue | undefined): {
  from?: string;
  to?: string;
} {
  if (!year || year === "all") return {};
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

/** Re-export for convenience */
export type { YearValue };
