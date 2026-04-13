/**
 * Formatters — locale es-MX.
 * Usar SIEMPRE estos helpers en lugar de format manual.
 */

const currencyFull = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const currencyCompact = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});

const numberCompact = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const percent = new Intl.NumberFormat("es-MX", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatCurrencyMXN(
  value: number | null | undefined,
  opts?: { compact?: boolean }
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return opts?.compact ? currencyCompact.format(value) : currencyFull.format(value);
}

export function formatNumber(
  value: number | null | undefined,
  opts?: { compact?: boolean }
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return opts?.compact ? numberCompact.format(value) : number.format(value);
}

export function formatPercent(
  value: number | null | undefined,
  opts?: { fromRatio?: boolean }
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const ratio = opts?.fromRatio ? value : value / 100;
  return percent.format(ratio);
}

export function formatDays(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  return `${number.format(rounded)} ${rounded === 1 ? "día" : "días"}`;
}

/** Fecha larga en es-MX: "13 abr 2026" */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Relativo al momento actual: "hace 2 días", "hace 3h", "ahora" */
export function formatRelative(
  input: string | Date | null | undefined,
  now: Date = new Date()
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = now.getTime() - d.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const prefix = future ? "en " : "hace ";
  if (mins < 1) return "ahora";
  if (mins < 60) return `${prefix}${mins}m`;
  if (hours < 24) return `${prefix}${hours}h`;
  if (days < 7) return `${prefix}${days}d`;
  if (weeks < 4) return `${prefix}${weeks}sem`;
  if (months < 12) return `${prefix}${months}mes`;
  return formatDate(d);
}

export type FormatKind = "currency" | "number" | "percent" | "days";

export function formatValue(
  value: number | null | undefined,
  kind: FormatKind,
  opts?: { compact?: boolean; fromRatio?: boolean }
): string {
  switch (kind) {
    case "currency":
      return formatCurrencyMXN(value, { compact: opts?.compact });
    case "percent":
      return formatPercent(value, { fromRatio: opts?.fromRatio });
    case "days":
      return formatDays(value);
    case "number":
    default:
      return formatNumber(value, { compact: opts?.compact });
  }
}
