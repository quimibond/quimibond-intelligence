"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import {
  AgingBuckets,
  type AgingBucketKey,
  type AgingData,
} from "@/components/patterns/aging-buckets";

// Maps primitive AgingBucketKey back to our URL param value. "current" does
// not filter the tables below (we only look at overdue buckets).
const KEY_TO_URL: Partial<Record<AgingBucketKey, string>> = {
  d1_30: "1-30",
  d31_60: "31-60",
  d61_90: "61-90",
  d90_plus: "90+",
};

interface Props {
  data: AgingData;
  currentBucket?: string;
  paramName?: string; // default "bucket"
}

export function ArAgingRow({ data, currentBucket, paramName = "bucket" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <AgingBuckets
      data={data}
      ariaLabel="Aging de cartera por cobrar"
      onBucketClick={(bucket) => {
        const urlValue = KEY_TO_URL[bucket];
        const p = new URLSearchParams(search.toString());
        if (!urlValue || currentBucket === urlValue) {
          p.delete(paramName);
        } else {
          p.set(paramName, urlValue);
        }
        // Reset any lingering pagination when changing filter.
        p.delete("page");
        p.delete("prPage");
        p.delete("caPage");
        p.delete("invPage");
        const qs = p.toString();
        router.push(`${pathname}${qs ? "?" + qs : ""}#companies`);
      }}
    />
  );
}
