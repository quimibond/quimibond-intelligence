import {
  type HistoryRange,
  isMonthRange,
  isYearRange,
  historyRangeLabel,
} from "@/components/patterns/history-range";

/** ISO date bounds (YYYY-MM-DD) + YYYY-MM month bounds for a HistoryRange. */
export interface PeriodBounds {
  from: string;
  to: string;
  fromMonth: string;
  toMonth: string;
  label: string;
}

/**
 * Resuelve una HistoryRange a fechas concretas. `to` es exclusivo
 * (primer día del siguiente día/mes/año).
 *
 * Acepta:
 *   - Presets:    "mtd" | "ytd" | "ltm" | "3y" | "5y" | "all"
 *   - Mes:        "m:YYYY-MM"  (ej. "m:2026-03" = marzo completo)
 *   - Año:        "y:YYYY"     (ej. "y:2024"   = todo 2024)
 */
export function periodBoundsForRange(
  range: HistoryRange,
  now = new Date()
): PeriodBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  // Mes específico
  if (isMonthRange(range)) {
    const [ys, ms] = range
      .slice(2)
      .split("-")
      .map((s) => parseInt(s, 10));
    const from = new Date(ys, ms - 1, 1);
    const to = new Date(ys, ms, 1);
    return {
      from: toIso(from),
      to: toIso(to),
      fromMonth: toIso(from).slice(0, 7),
      toMonth: toIso(to).slice(0, 7),
      label: historyRangeLabel(range),
    };
  }

  // Año específico
  if (isYearRange(range)) {
    const ys = parseInt(range.slice(2), 10);
    const from = new Date(ys, 0, 1);
    const to = new Date(ys + 1, 0, 1);
    return {
      from: toIso(from),
      to: toIso(to),
      fromMonth: toIso(from).slice(0, 7),
      toMonth: toIso(to).slice(0, 7),
      label: historyRangeLabel(range),
    };
  }

  let from: Date;
  let to: Date = new Date(y, m, d + 1);
  let label = "";

  switch (range) {
    case "mtd":
      from = new Date(y, m, 1);
      label = "Mes en curso";
      break;
    case "ytd":
      from = new Date(y, 0, 1);
      label = "Año en curso";
      break;
    case "ltm":
      from = new Date(y, m - 12, d + 1);
      label = "Últ. 12 meses";
      break;
    case "3y":
      from = new Date(y - 3, m, d + 1);
      label = "Últ. 3 años";
      break;
    case "5y":
      from = new Date(y - 5, m, d + 1);
      label = "Últ. 5 años";
      break;
    case "all":
      from = new Date(2014, 0, 1);
      to = new Date(y + 1, 0, 1);
      label = "Todo";
      break;
    default:
      from = new Date(y, m, 1);
      label = "Mes en curso";
      break;
  }

  return {
    from: toIso(from),
    to: toIso(to),
    fromMonth: toIso(from).slice(0, 7),
    toMonth: toIso(to).slice(0, 7),
    label,
  };
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Number of days between two ISO dates (inclusive of the start day). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}
