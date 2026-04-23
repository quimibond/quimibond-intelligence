"use client";

import { useRouter, usePathname } from "next/navigation";

import {
  AgingBuckets,
  type AgingBucketKey,
  type AgingData,
} from "@/components/patterns/aging-buckets";
import { toSearchString } from "@/lib/url-state";

// Map AgingBucketKey ("d1_30" etc) back to URL value ("1-30" etc).
// `current` is intentionally omitted — it does not filter the overdue table.
const KEY_TO_URL: Partial<Record<AgingBucketKey, string>> = {
  d1_30: "1-30",
  d31_60: "31-60",
  d61_90: "61-90",
  d90_plus: "90+",
};

interface AgingSectionProps {
  data: AgingData;
  /** URL value from `?aging=` (e.g. "31-60"); used to toggle off when re-clicked. */
  currentAging?: string;
}

export function AgingSection({ data, currentAging }: AgingSectionProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <AgingBuckets
      data={data}
      ariaLabel="Aging de cartera"
      onBucketClick={(bucket) => {
        const urlValue = KEY_TO_URL[bucket];
        if (!urlValue) return; // `current` does not filter the overdue table
        const next = currentAging === urlValue ? undefined : urlValue;
        const qs = toSearchString({ aging: next }, { dropEqual: {} });
        router.push(`${pathname}${qs}#overdue`);
      }}
    />
  );
}
