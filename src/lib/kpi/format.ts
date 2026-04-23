import type { Comparison, SourceKind } from "./types";

const LONG: Record<SourceKind, string> = {
  sat: "SAT (fiscal)",
  pl: "P&L contable",
  odoo: "Odoo operativo",
  canonical: "Canonical",
};

const SHORT: Record<SourceKind, string> = {
  sat: "SAT",
  pl: "P&L",
  odoo: "Odoo",
  canonical: "Canon.",
};

export function sourceLabel(s: SourceKind): string {
  return LONG[s];
}

export function sourceShortLabel(s: SourceKind): string {
  return SHORT[s];
}

/** Maps source to a Tailwind text color token. Used by SourceBadge. */
export function sourceColorClass(s: SourceKind): string {
  switch (s) {
    case "sat":
      return "text-primary"; // fiscal = primary accent
    case "pl":
      return "text-warning"; // P&L = orange/yellow to flag "contable, no fiscal"
    case "odoo":
      return "text-info";
    case "canonical":
      return "text-success"; // canonical = reconciled truth
  }
}

export interface DeltaInput {
  current: number | null;
  prior: number | null;
  label: string;
}

/** Compute a Comparison. Returns null when either input is null. */
export function computeDelta(input: DeltaInput): Comparison | null {
  const { current, prior, label } = input;
  if (current == null || prior == null) return null;
  const delta = current - prior;
  const deltaPct = prior === 0 ? null : (delta / prior) * 100;
  const direction: Comparison["direction"] =
    delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { label, priorValue: prior, delta, deltaPct, direction };
}

/** Drift severity bucket for a signed fraction (e.g. 0.15 = +15%). */
export function driftSeverity(
  diffFraction: number
): "info" | "warning" | "critical" {
  const abs = Math.abs(diffFraction);
  if (abs < 0.05) return "info";
  if (abs <= 0.15) return "warning";
  return "critical";
}
