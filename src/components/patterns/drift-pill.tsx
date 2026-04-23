"use client";

import { AlertTriangle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  driftSeverity,
  sourceLabel,
  type SourceKind,
  type KpiResult,
} from "@/lib/kpi";
import { formatCurrencyMXN } from "@/lib/formatters";

type SourceRow = NonNullable<KpiResult<number>["sources"]>[number];

export interface DriftPillProps {
  sources: SourceRow[];
  primary: SourceKind;
  /** Optional formatter override; default is MXN compact. */
  formatValue?: (v: number) => string;
}

const severityClass = {
  info: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-danger",
} as const;

/**
 * Pill that surfaces divergences between data sources. Rendered only when
 * `sources.length >= 2`. Click opens a popover with per-source values and
 * their diff vs the primary source.
 */
export function DriftPill({
  sources,
  primary,
  formatValue,
}: DriftPillProps) {
  if (sources.length < 2) return null;

  const maxAbs = sources
    .filter((s) => s.source !== primary)
    .reduce((max, s) => Math.max(max, Math.abs(s.diffPct)), 0);
  const severity = driftSeverity(maxAbs / 100);
  const fmt = formatValue ?? ((v: number) => formatCurrencyMXN(v, { compact: true }));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-5 gap-1 px-1.5 text-[10px] font-medium",
            severityClass[severity]
          )}
        >
          <AlertTriangle className="size-2.5" aria-hidden />
          <span>diff {maxAbs.toFixed(1)}%</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-xs">
        <div className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
          Divergencia entre fuentes
        </div>
        <table className="w-full">
          <tbody>
            {sources.map((s) => (
              <tr key={s.source} className="border-b border-border/40 last:border-0">
                <td className="py-1 pr-2 font-medium">{sourceLabel(s.source)}</td>
                <td className="py-1 text-right tabular-nums">{fmt(s.value)}</td>
                <td className="py-1 pl-2 text-right tabular-nums text-muted-foreground">
                  {s.source === primary ? "—" : `${s.diffPct > 0 ? "+" : ""}${s.diffPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}
