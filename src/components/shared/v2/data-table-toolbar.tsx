"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarIcon,
  Check,
  ChevronDown,
  FilterIcon,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────
export interface FacetOption {
  value: string;
  label: string;
  /** badge count opcional */
  count?: number;
}

export interface FacetFilter {
  /** Key en el URL (ej: "status") */
  key: string;
  /** Label mostrado en el botón (ej: "Estado") */
  label: string;
  options: FacetOption[];
  /** Si true, permite seleccionar múltiples valores. Default: true */
  multiple?: boolean;
}

export interface DateRangeFilter {
  /** Key en URL (ej: "from", "to"). Default: from/to */
  fromKey?: string;
  toKey?: string;
  label?: string;
}

export interface DataTableToolbarProps {
  /** Placeholder del input de búsqueda. Si undefined, oculta el search. */
  searchPlaceholder?: string;
  /** Key del search en el URL. Default: "q" */
  searchKey?: string;
  /** Date range (from/to) */
  dateRange?: DateRangeFilter;
  /** Filtros facetados multiselect */
  facets?: FacetFilter[];
  /** Texto del botón "limpiar todo" */
  resetLabel?: string;
  /** Prefijo aplicado a TODAS las claves (para múltiples tablas por página). */
  paramPrefix?: string;
  className?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Hook: sincronización con URL (replace sin scroll)
// ──────────────────────────────────────────────────────────────────────────
function useQueryParamSync(pagePrefix = "") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageKey = pagePrefix + "page";

  const setParams = React.useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (value == null) continue;
        if (Array.isArray(value)) {
          for (const v of value) if (v) params.append(key, v);
        } else if (value !== "") {
          params.set(key, value);
        }
      }
      // Reset page SIEMPRE que cambien filtros que no sean la propia page
      if (Object.keys(updates).some((k) => k !== pageKey)) {
        params.delete(pageKey);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, pageKey]
  );

  return { searchParams, setParams };
}

// Debounce simple
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ──────────────────────────────────────────────────────────────────────────
// Search input (sync con URL + debounce)
// ──────────────────────────────────────────────────────────────────────────
function ToolbarSearch({
  placeholder,
  searchKey,
}: {
  placeholder: string;
  searchKey: string;
}) {
  const prefix = useToolbarPrefix();
  const { searchParams, setParams } = useQueryParamSync(prefix);
  const initial = searchParams.get(searchKey) ?? "";
  const [value, setValue] = React.useState(initial);
  const debounced = useDebouncedValue(value, 300);
  const lastSent = React.useRef(initial);

  React.useEffect(() => {
    if (debounced === lastSent.current) return;
    lastSent.current = debounced;
    setParams({ [searchKey]: debounced || null });
  }, [debounced, searchKey, setParams]);

  // Sync externo (ej: botón "Limpiar todo")
  React.useEffect(() => {
    const param = searchParams.get(searchKey) ?? "";
    if (param !== lastSent.current) {
      lastSent.current = param;
      setValue(param);
    }
  }, [searchParams, searchKey]);

  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 pl-9 pr-8"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Limpiar búsqueda"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Date range filter (inputs nativos estilizados)
// ──────────────────────────────────────────────────────────────────────────
function ToolbarDateRange({ config }: { config: DateRangeFilter }) {
  const prefix = useToolbarPrefix();
  const { searchParams, setParams } = useQueryParamSync(prefix);
  const fromKey = config.fromKey ?? "from";
  const toKey = config.toKey ?? "to";
  const from = searchParams.get(fromKey) ?? "";
  const to = searchParams.get(toKey) ?? "";
  const [open, setOpen] = React.useState(false);

  const hasRange = Boolean(from || to);
  const label = config.label ?? "Fechas";

  const presets: Array<{ label: string; days: number }> = [
    { label: "Últimos 7 días", days: 7 },
    { label: "Últimos 30 días", days: 30 },
    { label: "Últimos 90 días", days: 90 },
    { label: "Año en curso", days: -1 }, // YTD especial
  ];

  const applyPreset = (days: number) => {
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr: string;
    if (days === -1) {
      fromStr = `${now.getFullYear()}-01-01`;
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      fromStr = d.toISOString().slice(0, 10);
    }
    setParams({ [fromKey]: fromStr, [toKey]: toStr });
    setOpen(false);
  };

  const display = hasRange
    ? `${formatDateShort(from) ?? "Inicio"} → ${formatDateShort(to) ?? "Hoy"}`
    : label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 border-dashed",
            hasRange && "border-solid bg-accent/30"
          )}
        >
          <CalendarIcon className="size-4" />
          <span className="truncate">{display}</span>
          {hasRange && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setParams({ [fromKey]: null, [toKey]: null });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setParams({ [fromKey]: null, [toKey]: null });
                }
              }}
              className="ml-1 rounded-sm p-0.5 hover:bg-muted"
              aria-label="Limpiar fechas"
            >
              <X className="size-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[18rem] space-y-3" align="start">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Atajos
          </span>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Desde
            </span>
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) =>
                setParams({ [fromKey]: e.target.value || null })
              }
              className="h-8"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Hasta
            </span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setParams({ [toKey]: e.target.value || null })}
              className="h-8"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setParams({ [fromKey]: null, [toKey]: null })}
          >
            Limpiar
          </Button>
          <Button
            size="sm"
            className="h-7"
            onClick={() => setOpen(false)}
          >
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Facet filter (popover + checkboxes)
// ──────────────────────────────────────────────────────────────────────────
function ToolbarFacet({ filter }: { filter: FacetFilter }) {
  const prefix = useToolbarPrefix();
  const { searchParams, setParams } = useQueryParamSync(prefix);
  const multiple = filter.multiple ?? true;
  const selected = searchParams.getAll(filter.key);
  const selectedSet = new Set(selected);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filteredOptions = query
    ? filter.options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : filter.options;

  const toggle = (value: string) => {
    if (!multiple) {
      setParams({ [filter.key]: selectedSet.has(value) ? null : value });
      setOpen(false);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setParams({ [filter.key]: Array.from(next) });
  };

  const clear = () => setParams({ [filter.key]: null });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 border-dashed",
            selected.length > 0 && "border-solid bg-accent/30"
          )}
        >
          <FilterIcon className="size-3.5" />
          {filter.label}
          {selected.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              {selected.length > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 text-[10px]">
                  {selected.length}
                </Badge>
              ) : (
                <div className="flex gap-1">
                  {filter.options
                    .filter((o) => selectedSet.has(o.value))
                    .map((o) => (
                      <Badge
                        key={o.value}
                        variant="secondary"
                        className="rounded-sm px-1 text-[10px]"
                      >
                        {o.label}
                      </Badge>
                    ))}
                </div>
              )}
            </>
          )}
          <ChevronDown className="ml-auto size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        {filter.options.length >= 8 && (
          <div className="border-b p-2">
            <Input
              placeholder={`Buscar ${filter.label.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto p-1">
          {filteredOptions.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              Sin resultados
            </div>
          ) : (
            filteredOptions.map((o) => {
              const isSel = selectedSet.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={cn(
                    "flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    isSel && "bg-accent/40"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded-[4px] border",
                      isSel
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input"
                    )}
                  >
                    {isSel && <Check className="size-3" />}
                  </div>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.count != null && (
                    <span className="tabular-nums text-[10px] text-muted-foreground">
                      {o.count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        {selected.length > 0 && (
          <>
            <Separator />
            <div className="p-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                onClick={clear}
              >
                Limpiar selección
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Toolbar principal
// ──────────────────────────────────────────────────────────────────────────
export function DataTableToolbar({
  searchPlaceholder,
  searchKey = "q",
  dateRange,
  facets,
  resetLabel = "Limpiar filtros",
  paramPrefix = "",
  className,
}: DataTableToolbarProps) {
  const { searchParams, setParams } = useQueryParamSync(paramPrefix);

  // Aplica prefix a cualquier key declarada por el caller.
  const pxSearchKey = paramPrefix + searchKey;
  const pxDateRange: DateRangeFilter | undefined = dateRange
    ? {
        fromKey: paramPrefix + (dateRange.fromKey ?? "from"),
        toKey: paramPrefix + (dateRange.toKey ?? "to"),
        label: dateRange.label,
      }
    : undefined;
  const pxFacets: FacetFilter[] | undefined = facets?.map((f) => ({
    ...f,
    key: paramPrefix + f.key,
  }));

  const activeKeys: string[] = [];
  if (searchParams.get(pxSearchKey)) activeKeys.push(pxSearchKey);
  if (pxDateRange) {
    if (pxDateRange.fromKey && searchParams.get(pxDateRange.fromKey))
      activeKeys.push(pxDateRange.fromKey);
    if (pxDateRange.toKey && searchParams.get(pxDateRange.toKey))
      activeKeys.push(pxDateRange.toKey);
  }
  for (const f of pxFacets ?? []) {
    if (searchParams.getAll(f.key).length > 0) activeKeys.push(f.key);
  }
  const hasFilters = activeKeys.length > 0;

  const clearAll = () => {
    const updates: Record<string, null> = {};
    for (const k of activeKeys) updates[k] = null;
    setParams(updates);
  };

  return (
    <ToolbarPrefixContext.Provider value={paramPrefix}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          className
        )}
      >
        {searchPlaceholder && (
          <ToolbarSearch
            placeholder={searchPlaceholder}
            searchKey={pxSearchKey}
          />
        )}
        {pxDateRange && <ToolbarDateRange config={pxDateRange} />}
        {pxFacets?.map((f) => <ToolbarFacet key={f.key} filter={f} />)}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-muted-foreground"
            onClick={clearAll}
          >
            <X className="size-3.5" />
            {resetLabel}
          </Button>
        )}
      </div>
    </ToolbarPrefixContext.Provider>
  );
}

// Prefix compartido entre toolbar y pagination (para reset de page correcto).
const ToolbarPrefixContext = React.createContext<string>("");
export function useToolbarPrefix() {
  return React.useContext(ToolbarPrefixContext);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function formatDateShort(iso: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}
