import * as React from "react";
import { cn } from "@/lib/utils";

export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export interface AgingData {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

const BUCKETS: Array<{ key: AgingBucketKey; label: string; varName: string }> = [
  { key: "current",  label: "Corriente", varName: "--aging-current" },
  { key: "d1_30",    label: "1-30",      varName: "--aging-1-30" },
  { key: "d31_60",   label: "31-60",     varName: "--aging-31-60" },
  { key: "d61_90",   label: "61-90",     varName: "--aging-61-90" },
  { key: "d90_plus", label: "90+",       varName: "--aging-90-plus" },
];

function fmtMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

interface AgingBucketsProps {
  data: AgingData;
  ariaLabel: string;
  onBucketClick?: (bucket: AgingBucketKey) => void;
  showLegend?: boolean;
  className?: string;
}

export function AgingBuckets({ data, ariaLabel, onBucketClick, showLegend = true, className }: AgingBucketsProps) {
  const total = BUCKETS.reduce((acc, b) => acc + data[b.key], 0);
  if (total <= 0) {
    return (
      <div role="img" aria-label={ariaLabel} className={cn("text-sm text-muted-foreground", className)}>
        Sin cartera abierta
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-6 w-full overflow-hidden rounded-md"
      >
        {BUCKETS.map((b) => {
          const pct = (data[b.key] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b.key}
              data-bucket={b.key}
              style={{ width: `${pct}%`, background: `var(${b.varName})` }}
              aria-label={`${b.label}: ${fmtMxn(data[b.key])}`}
              title={`${b.label}: ${fmtMxn(data[b.key])}`}
            />
          );
        })}
      </div>

      {showLegend && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
          {BUCKETS.map((b) => {
            const inner = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: `var(${b.varName})` }} />
                <span className="font-medium">{b.label}</span>
                <span className="tabular-nums text-muted-foreground">{fmtMxn(data[b.key])}</span>
              </span>
            );
            return (
              <li key={b.key}>
                {onBucketClick ? (
                  <button
                    type="button"
                    aria-label={`Filtrar ${b.label}`}
                    className="min-h-[32px] text-left hover:underline focus-visible:outline focus-visible:outline-2"
                    onClick={() => onBucketClick(b.key)}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
