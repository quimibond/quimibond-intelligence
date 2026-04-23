import type { AgingData } from "@/components/patterns/aging-buckets";

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function adaptAging(b: Record<string, number>): AgingData {
  return {
    current: num(b?.current),
    d1_30: num(b?.["1-30"]),
    d31_60: num(b?.["31-60"]),
    d61_90: num(b?.["61-90"]),
    d90_plus: num(b?.["90+"]),
  };
}
