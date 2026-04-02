"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface AgingData {
  current: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  "90_plus": number;
  total_outstanding: number;
}

const BUCKETS = [
  { key: "current" as const, label: "Al corriente", color: "bg-success" },
  { key: "1_30" as const, label: "1-30 dias", color: "bg-warning" },
  { key: "31_60" as const, label: "31-60 dias", color: "bg-warning/70" },
  { key: "61_90" as const, label: "61-90 dias", color: "bg-danger" },
  { key: "90_plus" as const, label: "90+ dias", color: "bg-danger/80" },
] as const;

function fmt(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function AgingChart({ data }: { data: AgingData | null }) {
  const buckets = useMemo(() => {
    if (!data) return [];
    const total = data.total_outstanding || 1;
    return BUCKETS.map((b) => ({
      ...b,
      value: Number((data as unknown as Record<string, number>)[b.key] ?? 0),
      pct: (Number((data as unknown as Record<string, number>)[b.key] ?? 0) / total) * 100,
    })).filter((b) => b.value > 0);
  }, [data]);

  if (!data || data.total_outstanding === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Sin saldo pendiente
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-8 w-full overflow-hidden rounded-md">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={cn(b.color, "transition-all")}
            style={{ width: `${Math.max(b.pct, 2)}%` }}
            title={`${b.label}: ${fmt(b.value)} (${b.pct.toFixed(0)}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => {
          const value = Number((data as unknown as Record<string, number>)[b.key] ?? 0);
          return (
            <div key={b.key} className="flex items-center gap-2 text-sm">
              <span className={cn("h-3 w-3 rounded-sm shrink-0", b.color)} />
              <span className="text-muted-foreground">{b.label}</span>
              <span className="ml-auto font-medium tabular-nums">
                {fmt(value)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-sm font-medium text-muted-foreground">
          Total pendiente
        </span>
        <span className="text-lg font-bold tabular-nums">
          {fmt(data.total_outstanding)}
        </span>
      </div>
    </div>
  );
}
