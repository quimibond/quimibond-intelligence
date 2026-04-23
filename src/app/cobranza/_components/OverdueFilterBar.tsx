"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";

import { toSearchString } from "@/lib/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface OverdueFilterParams {
  aging?: string;
  q?: string;
  salesperson?: string;
}

interface OverdueFilterBarProps {
  params: OverdueFilterParams;
  salespeopleOptions: string[];
}

export function OverdueFilterBar({
  params,
  salespeopleOptions,
}: OverdueFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync q when URL param changes externally
  useEffect(() => {
    setQ(params.q ?? "");
  }, [params.q]);

  function pushParams(next: Partial<OverdueFilterParams>) {
    const merged: Record<string, string | undefined> = {
      aging: params.aging,
      q: params.q,
      salesperson: params.salesperson,
      ...next,
    };
    if (merged.q === "") merged.q = undefined;
    if (merged.salesperson === "") merged.salesperson = undefined;
    const qs = toSearchString(merged, { dropEqual: {} });
    router.push(`${pathname}${qs}#overdue`);
  }

  function onSearchChange(v: string) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: v });
    }, 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {params.aging && (
        <Badge variant="secondary" className="gap-1 pr-1">
          Aging: {params.aging}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            aria-label="Quitar filtro de aging"
            onClick={() => pushParams({ aging: undefined })}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </Button>
        </Badge>
      )}

      <Input
        type="search"
        placeholder="Buscar factura o referencia"
        value={q}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full max-w-xs"
        aria-label="Buscar facturas vencidas"
      />

      <Select
        value={params.salesperson ?? "__all__"}
        onValueChange={(v) =>
          pushParams({ salesperson: v === "__all__" ? undefined : v })
        }
      >
        <SelectTrigger className="w-[180px]" aria-label="Vendedor">
          <SelectValue placeholder="Vendedor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todos</SelectItem>
          {salespeopleOptions.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
