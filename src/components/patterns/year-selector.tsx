"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { availableYears, MIN_AVAILABLE_YEAR, parseYearParam, YearValue } from "@/lib/queries/_shared/year-filter";
import { Calendar } from "lucide-react";

interface YearSelectorProps {
  paramName?: string;
  preserveParams?: boolean;
  label?: string;
  minYear?: number;
}

export function YearSelector({
  paramName = "year",
  preserveParams = true,
  label = "Año",
  minYear = MIN_AVAILABLE_YEAR,
}: YearSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentRaw = searchParams.get(paramName);
  const currentValue: YearValue = parseYearParam(currentRaw ?? undefined);
  const displayValue = currentValue === "all" ? "all" : String(currentValue);

  const years = availableYears().filter((y) => y >= minYear);

  function handleChange(value: string) {
    const newParams = preserveParams ? new URLSearchParams(searchParams.toString()) : new URLSearchParams();
    if (value === String(new Date().getFullYear())) {
      newParams.delete(paramName);
    } else {
      newParams.set(paramName, value);
    }
    router.push(`${pathname}?${newParams.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
      <label className="text-sm text-muted-foreground">{label}:</label>
      <Select value={displayValue} onValueChange={handleChange}>
        <SelectTrigger className="w-[140px] h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los años</SelectItem>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
