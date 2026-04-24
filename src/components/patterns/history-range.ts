/**
 * Pure, server-safe helpers for HistorySelector — no React, no "use client".
 * Imported by both the client component and server pages.
 */

export type HistoryRange = "mtd" | "ytd" | "ltm" | "3y" | "5y" | "all";

export const HISTORY_RANGES: readonly HistoryRange[] = [
  "mtd",
  "ytd",
  "ltm",
  "3y",
  "5y",
  "all",
] as const;

export const HISTORY_RANGE_LABEL: Record<HistoryRange, string> = {
  mtd: "Mes en curso",
  ytd: "Año en curso",
  ltm: "Últ. 12 meses",
  "3y": "Últ. 3 años",
  "5y": "Últ. 5 años",
  all: "Todo el historial",
};

export function parseHistoryRange(
  raw: string | string[] | undefined,
  fallback: HistoryRange = "ltm"
): HistoryRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return fallback;
  return (HISTORY_RANGES as readonly string[]).includes(v)
    ? (v as HistoryRange)
    : fallback;
}
