/**
 * Pure, server-safe helpers for HistorySelector — no React, no "use client".
 * Imported by both the client component and server pages.
 *
 * HistoryRange acepta 3 formas:
 *   - Presets relativos: "mtd" | "ytd" | "ltm" | "3y" | "5y" | "all"
 *   - Mes específico:    "m:YYYY-MM"   (ej. "m:2026-03")
 *   - Año específico:    "y:YYYY"      (ej. "y:2024")
 */

export type PresetRange = "mtd" | "ytd" | "ltm" | "3y" | "5y" | "all";
export type MonthRange = `m:${string}`;
export type YearRange = `y:${string}`;
export type HistoryRange = PresetRange | MonthRange | YearRange;

export const PRESET_RANGES: readonly PresetRange[] = [
  "mtd",
  "ytd",
  "ltm",
  "3y",
  "5y",
  "all",
] as const;

// Backwards-compat export
export const HISTORY_RANGES = PRESET_RANGES;

export const PRESET_RANGE_LABEL: Record<PresetRange, string> = {
  mtd: "Mes en curso",
  ytd: "Año en curso",
  ltm: "Últ. 12 meses",
  "3y": "Últ. 3 años",
  "5y": "Últ. 5 años",
  all: "Todo el historial",
};

export const HISTORY_RANGE_LABEL = PRESET_RANGE_LABEL;

const SPANISH_MONTHS_SHORT = [
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

export function isPresetRange(v: string): v is PresetRange {
  return (PRESET_RANGES as readonly string[]).includes(v);
}

export function isMonthRange(v: string): v is MonthRange {
  return /^m:\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isYearRange(v: string): v is YearRange {
  return /^y:\d{4}$/.test(v);
}

export function parseHistoryRange(
  raw: string | string[] | undefined,
  fallback: HistoryRange = "ltm"
): HistoryRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return fallback;
  if (isPresetRange(v)) return v;
  if (isMonthRange(v)) return v;
  if (isYearRange(v)) return v;
  return fallback;
}

/** Human label for any HistoryRange. */
export function historyRangeLabel(r: HistoryRange): string {
  if (isPresetRange(r)) return PRESET_RANGE_LABEL[r];
  if (isMonthRange(r)) {
    const ym = r.slice(2);
    const [y, m] = ym.split("-");
    const mi = parseInt(m, 10) - 1;
    return `${SPANISH_MONTHS_SHORT[mi] ?? m} ${y}`;
  }
  if (isYearRange(r)) return `Año ${r.slice(2)}`;
  return String(r);
}

/** Lista de meses seleccionables, ordenados del más reciente al más antiguo. */
export function monthsBack(
  fromMonth = "2024-01",
  now: Date = new Date()
): MonthRange[] {
  const [fy, fm] = fromMonth.split("-").map((x) => parseInt(x, 10));
  const ny = now.getFullYear();
  const nm = now.getMonth() + 1;
  const out: MonthRange[] = [];
  let y = ny;
  let m = nm;
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`m:${y}-${String(m).padStart(2, "0")}` as MonthRange);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Años disponibles desde `fromYear` hasta el año actual. */
export function yearsBack(fromYear = 2024, now: Date = new Date()): YearRange[] {
  const ny = now.getFullYear();
  const out: YearRange[] = [];
  for (let y = ny; y >= fromYear; y--) {
    out.push(`y:${y}` as YearRange);
  }
  return out;
}
