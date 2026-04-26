"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Import from individual files: client component cannot pull from the
// barrel (it transitively re-exports server-only modules).
import { FilterBar, type FilterOption } from "@/components/patterns/filter-bar";

interface Props {
  bucket?: string;
  risk?: "critical" | null;
}

export function ArByCompanyFilterBar({ bucket, risk }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function update(key: string, value: string | undefined) {
    const p = new URLSearchParams(search.toString());
    if (value == null || value === "") p.delete(key);
    else p.set(key, value);
    p.delete("caPage"); // reset pagination
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}#companies`);
  }

  const filters: FilterOption<string>[] = [
    {
      key: "bucket",
      label: "Aging",
      value: bucket,
      options: [
        { value: "1-30", label: "1-30" },
        { value: "31-60", label: "31-60" },
        { value: "61-90", label: "61-90" },
        { value: "90+", label: "90+" },
      ],
    },
    {
      key: "risk",
      label: "Riesgo",
      value: risk ?? undefined,
      options: [{ value: "critical", label: "Crítico" }],
    },
  ];

  return <FilterBar filters={filters} onChange={(k, v) => update(k, v)} />;
}
