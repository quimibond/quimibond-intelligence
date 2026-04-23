"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toSearchString } from "@/lib/url-state";
import { cn } from "@/lib/utils";
import type {
  CompanyTypeFilter,
  CompanyTierFilter,
  CompanyActivityFilter,
} from "@/lib/queries/sp13/empresas";

export interface EmpresasFilterBarParams {
  q: string;
  type: CompanyTypeFilter | "all";
  tier: CompanyTierFilter | "all";
  activity: CompanyActivityFilter | "all";
  sort: string;
  page: number;
  limit: number;
  range?: string;
}

interface Props {
  params: EmpresasFilterBarParams;
}

const TYPE_OPTIONS: Array<{ value: EmpresasFilterBarParams["type"]; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "cliente", label: "Clientes" },
  { value: "proveedor", label: "Proveedores" },
  { value: "ambos", label: "Ambos" },
  { value: "inactivo", label: "Inactivos" },
];

const TIER_OPTIONS: Array<{ value: EmpresasFilterBarParams["tier"]; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
];

const ACTIVITY_OPTIONS: Array<{
  value: EmpresasFilterBarParams["activity"];
  label: string;
}> = [
  { value: "all", label: "Toda" },
  { value: "activa", label: "Activa" },
  { value: "dormida", label: "Dormida" },
  { value: "nueva_90d", label: "Nueva 90d" },
];

export function EmpresasFilterBar({ params }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [qLocal, setQLocal] = React.useState(params.q);
  const qTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback(
    (next: Partial<EmpresasFilterBarParams>) => {
      const merged = { ...params, ...next };
      const qs = toSearchString(
        {
          q: merged.q || undefined,
          type: merged.type,
          tier: merged.tier,
          activity: merged.activity,
          sort: merged.sort,
          page: merged.page,
          limit: merged.limit,
          range: merged.range,
        },
        {
          dropEqual: {
            type: "all",
            tier: "all",
            activity: "all",
            sort: "-ltv",
            page: 1,
            limit: 25,
            range: "ytd",
          },
        },
      );
      router.push(`${pathname}${qs}`);
    },
    [params, pathname, router],
  );

  const setType = (v: EmpresasFilterBarParams["type"]) => push({ type: v, page: 1 });
  const setTier = (v: EmpresasFilterBarParams["tier"]) => push({ tier: v, page: 1 });
  const setActivity = (v: EmpresasFilterBarParams["activity"]) =>
    push({ activity: v, page: 1 });

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQLocal(v);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => push({ q: v.trim(), page: 1 }), 300);
  };

  const anyFilter =
    params.q.length > 0 ||
    params.type !== "all" ||
    params.tier !== "all" ||
    params.activity !== "all";

  const clearAll = () => {
    setQLocal("");
    push({ q: "", type: "all", tier: "all", activity: "all", page: 1 });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <ChipGroup label="Tipo" value={params.type} options={TYPE_OPTIONS} onChange={setType} />
        <ChipGroup label="Tier" value={params.tier} options={TIER_OPTIONS} onChange={setTier} />
        <ChipGroup
          label="Actividad"
          value={params.activity}
          options={ACTIVITY_OPTIONS}
          onChange={setActivity}
        />
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-9">
            <X className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>
      <Input
        type="search"
        value={qLocal}
        onChange={handleSearch}
        placeholder="Buscar por nombre o RFC…"
        className="h-10 w-full"
        aria-label="Buscar por nombre o RFC"
      />
    </div>
  );
}

interface ChipGroupProps<V extends string> {
  label: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (v: V) => void;
}

function ChipGroup<V extends string>({ label, value, options, onChange }: ChipGroupProps<V>) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "min-h-[32px] rounded-full border px-3 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
