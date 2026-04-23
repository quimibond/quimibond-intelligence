"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toSearchString } from "@/lib/url-state";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "customer" | "supplier";
type BlacklistFilter = "any" | "none" | "69b_presunto" | "69b_definitivo";
type SortKey =
  | "-ltv_mxn"
  | "-revenue_ytd_mxn"
  | "-overdue_amount_mxn"
  | "-open_company_issues_count"
  | "display_name";

export interface CompanyFilterBarProps {
  params: {
    q: string;
    type: TypeFilter;
    blacklist: BlacklistFilter;
    shadowOnly: boolean;
    sort: SortKey;
    page: number;
    limit: number;
  };
}

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "Todos",
  customer: "Clientes",
  supplier: "Proveedores",
};

const TYPE_ORDER: TypeFilter[] = ["all", "customer", "supplier"];

const SORT_LABELS: Record<SortKey, string> = {
  "-ltv_mxn": "LTV (desc)",
  "-revenue_ytd_mxn": "YTD (desc)",
  "-overdue_amount_mxn": "Cartera vencida (desc)",
  "-open_company_issues_count": "Issues pendientes (desc)",
  display_name: "Nombre (A-Z)",
};

export function CompanyFilterBar({ params }: CompanyFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [qLocal, setQLocal] = React.useState(params.q);
  const qTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback(
    (next: Partial<CompanyFilterBarProps["params"]>) => {
      const merged = { ...params, ...next };
      const qs = toSearchString(
        {
          q: merged.q || undefined,
          type: merged.type,
          blacklist: merged.blacklist,
          shadowOnly: merged.shadowOnly || undefined,
          sort: merged.sort,
          page: merged.page,
          limit: merged.limit,
        },
        {
          dropEqual: {
            type: "all",
            blacklist: "any",
            sort: "-ltv_mxn",
            page: 1,
            limit: 50,
          },
        }
      );
      router.push(`${pathname}${qs}`);
    },
    [params, pathname, router]
  );

  const setType = (t: TypeFilter) => push({ type: t, page: 1 });
  const setBlacklist = (v: string) => push({ blacklist: v as BlacklistFilter, page: 1 });
  const setSort = (v: string) => push({ sort: v as SortKey, page: 1 });
  const setShadowOnly = (v: boolean) => push({ shadowOnly: v, page: 1 });

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQLocal(v);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => push({ q: v.trim(), page: 1 }), 300);
  };

  const anyFilter =
    params.q.length > 0 ||
    params.type !== "all" ||
    params.blacklist !== "any" ||
    params.shadowOnly ||
    params.sort !== "-ltv_mxn";

  const clearAll = () => {
    setQLocal("");
    push({
      q: "",
      type: "all",
      blacklist: "any",
      shadowOnly: false,
      sort: "-ltv_mxn",
      page: 1,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_ORDER.map((t) => {
          const active = params.type === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => setType(t)}
              className={cn(
                "min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors",
                active
                  ? "bg-status-ok/15 border-status-ok/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {TYPE_LABELS[t]}
            </button>
          );
        })}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="min-h-[36px]">
            <X className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={qLocal}
          onChange={handleSearch}
          placeholder="Buscar nombre o RFC..."
          className="h-10 w-full sm:flex-1"
          aria-label="Buscar por nombre o RFC"
        />
        <Select value={params.blacklist} onValueChange={setBlacklist}>
          <SelectTrigger className="h-10 w-full sm:w-48" aria-label="Filtrar por lista negra">
            <SelectValue placeholder="Lista negra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Lista negra: cualquiera</SelectItem>
            <SelectItem value="none">Sin lista negra</SelectItem>
            <SelectItem value="69b_presunto">Solo 69B presunto</SelectItem>
            <SelectItem value="69b_definitivo">Solo 69B definitivo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={params.sort} onValueChange={setSort}>
          <SelectTrigger className="h-10 w-full sm:w-56" aria-label="Ordenar por">
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex min-h-[36px] items-center gap-2 text-xs">
          <Checkbox
            checked={params.shadowOnly}
            onCheckedChange={(v) => setShadowOnly(Boolean(v))}
            aria-label="Solo sombra"
          />
          Solo sombra
        </label>
      </div>
    </div>
  );
}
