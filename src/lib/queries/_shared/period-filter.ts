/**
 * Period filter — richer replacement for year-filter.
 *
 * Supports presets (this-year, last-30d…), year, quarter, month and custom
 * date ranges. Serialized to a compact URL string so every page section can
 * carry its own state with a unique paramName prefix.
 *
 * Usage on the server side:
 *   const period = parsePeriod(params.pr_period);
 *   const { from, to } = periodBounds(period);
 */

import type { YearValue } from "./year-filter";

export type PeriodPreset =
  | "today"
  | "this-week"
  | "this-month"
  | "this-quarter"
  | "this-year"
  | "last-7d"
  | "last-30d"
  | "last-90d"
  | "last-12m"
  | "last-year"
  | "all";

export type PeriodValue =
  | { kind: "preset"; preset: PeriodPreset }
  | { kind: "year"; year: number }
  | { kind: "quarter"; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: "month"; year: number; month: number } // month 1-12
  | { kind: "custom"; from: string; to: string }; // ISO dates

export const DEFAULT_PERIOD: PeriodValue = {
  kind: "preset",
  preset: "this-year",
};

const PRESETS: readonly PeriodPreset[] = [
  "today",
  "this-week",
  "this-month",
  "this-quarter",
  "this-year",
  "last-7d",
  "last-30d",
  "last-90d",
  "last-12m",
  "last-year",
  "all",
];

export function periodBounds(value: PeriodValue): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getFullYear();

  switch (value.kind) {
    case "preset":
      switch (value.preset) {
        case "today": {
          const start = new Date(y, now.getMonth(), now.getDate());
          const end = new Date(y, now.getMonth(), now.getDate() + 1);
          return { from: start, to: end };
        }
        case "this-week": {
          const day = now.getDay(); // 0 sun .. 6 sat
          const monday = new Date(
            y,
            now.getMonth(),
            now.getDate() - ((day + 6) % 7),
          );
          const nextMonday = new Date(monday);
          nextMonday.setDate(monday.getDate() + 7);
          return { from: monday, to: nextMonday };
        }
        case "this-month":
          return {
            from: new Date(y, now.getMonth(), 1),
            to: new Date(y, now.getMonth() + 1, 1),
          };
        case "this-quarter": {
          const q = Math.floor(now.getMonth() / 3);
          return {
            from: new Date(y, q * 3, 1),
            to: new Date(y, q * 3 + 3, 1),
          };
        }
        case "this-year":
          return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
        case "last-7d":
          return { from: new Date(Date.now() - 7 * 86400000), to: now };
        case "last-30d":
          return { from: new Date(Date.now() - 30 * 86400000), to: now };
        case "last-90d":
          return { from: new Date(Date.now() - 90 * 86400000), to: now };
        case "last-12m":
          return {
            from: new Date(y - 1, now.getMonth(), now.getDate()),
            to: now,
          };
        case "last-year":
          return { from: new Date(y - 1, 0, 1), to: new Date(y, 0, 1) };
        case "all":
          return { from: new Date("2014-01-01"), to: new Date(y + 1, 0, 1) };
      }
      // exhaustive — fallthrough guarded below
      break;
    case "year":
      return {
        from: new Date(value.year, 0, 1),
        to: new Date(value.year + 1, 0, 1),
      };
    case "quarter":
      return {
        from: new Date(value.year, (value.quarter - 1) * 3, 1),
        to: new Date(value.year, value.quarter * 3, 1),
      };
    case "month":
      return {
        from: new Date(value.year, value.month - 1, 1),
        to: new Date(value.year, value.month, 1),
      };
    case "custom":
      return { from: new Date(value.from), to: new Date(value.to) };
  }

  // unreachable fallback — keeps TS happy for older targets
  return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
}

/** Returns ISO date strings (YYYY-MM-DD) for the `from`/`to` bounds. */
export function periodBoundsIso(value: PeriodValue): {
  from: string;
  to: string;
} {
  const { from, to } = periodBounds(value);
  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
  };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compact URL serialization:
 *   "this-year" | "y:2025" | "q:2026-1" | "m:2026-04"
 *   | "c:2025-01-01_2025-06-30"
 */
export function serializePeriod(value: PeriodValue): string {
  switch (value.kind) {
    case "preset":
      return value.preset;
    case "year":
      return `y:${value.year}`;
    case "quarter":
      return `q:${value.year}-${value.quarter}`;
    case "month":
      return `m:${value.year}-${String(value.month).padStart(2, "0")}`;
    case "custom":
      return `c:${value.from}_${value.to}`;
  }
}

export function parsePeriod(
  raw: string | string[] | undefined,
): PeriodValue {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return DEFAULT_PERIOD;

  if ((PRESETS as readonly string[]).includes(v)) {
    return { kind: "preset", preset: v as PeriodPreset };
  }

  const yMatch = v.match(/^y:(\d{4})$/);
  if (yMatch) return { kind: "year", year: parseInt(yMatch[1], 10) };

  const qMatch = v.match(/^q:(\d{4})-([1-4])$/);
  if (qMatch) {
    return {
      kind: "quarter",
      year: parseInt(qMatch[1], 10),
      quarter: parseInt(qMatch[2], 10) as 1 | 2 | 3 | 4,
    };
  }

  const mMatch = v.match(/^m:(\d{4})-(\d{2})$/);
  if (mMatch) {
    const month = parseInt(mMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return { kind: "month", year: parseInt(mMatch[1], 10), month };
    }
  }

  const cMatch = v.match(/^c:(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (cMatch) return { kind: "custom", from: cMatch[1], to: cMatch[2] };

  return DEFAULT_PERIOD;
}

export function periodLabel(value: PeriodValue): string {
  const monthNames = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  switch (value.kind) {
    case "preset": {
      const labels: Record<PeriodPreset, string> = {
        today: "Hoy",
        "this-week": "Esta semana",
        "this-month": "Este mes",
        "this-quarter": "Este trimestre",
        "this-year": "Este año",
        "last-7d": "Últimos 7 días",
        "last-30d": "Últimos 30 días",
        "last-90d": "Últimos 90 días",
        "last-12m": "Últimos 12 meses",
        "last-year": "Año pasado",
        all: "Todo",
      };
      return labels[value.preset];
    }
    case "year":
      return String(value.year);
    case "quarter":
      return `Q${value.quarter} ${value.year}`;
    case "month":
      return `${monthNames[value.month - 1]} ${value.year}`;
    case "custom":
      return `${value.from} → ${value.to}`;
  }
}

/** Backward-compat shim while pages migrate off YearValue. */
export function periodFromYearValue(y: YearValue | undefined): PeriodValue {
  if (y === undefined) return DEFAULT_PERIOD;
  if (y === "all") return { kind: "preset", preset: "all" };
  return { kind: "year", year: y };
}
