"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type GroupByTemporal = "day" | "week" | "month" | "quarter" | "year";

export interface GroupByToggleProps {
  paramName?: string;
  defaultValue?: GroupByTemporal;
  options?: GroupByTemporal[];
  className?: string;
}

const LABELS: Record<GroupByTemporal, string> = {
  day: "Día",
  week: "Semana",
  month: "Mes",
  quarter: "Trim",
  year: "Año",
};

export function GroupByToggle({
  paramName = "groupBy",
  defaultValue = "month",
  options = ["day", "week", "month", "quarter", "year"],
  className,
}: GroupByToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current =
    (searchParams.get(paramName) as GroupByTemporal | null) ?? defaultValue;

  function apply(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === defaultValue) params.delete(paramName);
    else params.set(paramName, v);
    const qs = params.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <Tabs value={current} onValueChange={apply} className={className}>
      <TabsList className="h-7">
        {options.map((o) => (
          <TabsTrigger
            key={o}
            value={o}
            className="text-xs px-2.5 py-0.5 h-6"
          >
            {LABELS[o]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function parseGroupBy(
  raw: string | string[] | undefined,
  fallback: GroupByTemporal = "month",
): GroupByTemporal {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const valid: GroupByTemporal[] = ["day", "week", "month", "quarter", "year"];
  if (v && (valid as string[]).includes(v)) return v as GroupByTemporal;
  return fallback;
}

/** PostgreSQL `date_trunc` argument for a GroupByTemporal. */
export function groupByTrunc(v: GroupByTemporal): string {
  return v;
}
