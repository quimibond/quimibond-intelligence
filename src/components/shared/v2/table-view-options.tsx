"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings2, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface ViewColumn {
  key: string;
  label: string;
  alwaysVisible?: boolean;
  defaultHidden?: boolean;
}

interface TableViewOptionsProps {
  columns: ViewColumn[];
  /** Prefijo de key en URL. Default: "" */
  paramPrefix?: string;
  /** Key en URL donde se guarda la lista. Default: "cols" */
  paramKey?: string;
}

/**
 * TableViewOptions — control de visibilidad de columnas sincronizado con URL.
 *
 * El valor default son las columnas marcadas como `defaultHidden === false`.
 * Cuando el usuario ajusta, la URL se actualiza con `?{prefix}cols=key,key,key`.
 * El server component lee el param y filtra `columns` antes de pasarlo a
 * `<DataTable visibleKeys={...} />`.
 */
export function TableViewOptions({
  columns,
  paramPrefix = "",
  paramKey = "cols",
}: TableViewOptionsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fullKey = paramPrefix + paramKey;

  const defaultVisible = React.useMemo(
    () =>
      columns
        .filter((c) => !c.defaultHidden || c.alwaysVisible)
        .map((c) => c.key),
    [columns]
  );

  const current = React.useMemo(() => {
    const raw = searchParams.get(fullKey);
    if (raw == null) return new Set(defaultVisible);
    const set = new Set(raw.split(",").filter(Boolean));
    // Siempre incluye columnas alwaysVisible
    for (const c of columns) if (c.alwaysVisible) set.add(c.key);
    return set;
  }, [searchParams, fullKey, defaultVisible, columns]);

  const toggle = (key: string, alwaysVisible?: boolean) => {
    if (alwaysVisible) return;
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const params = new URLSearchParams(searchParams.toString());
    // Si coincide con el default, borra el param para mantener URL limpia
    const sortedNext = Array.from(next).sort();
    const sortedDefault = [...defaultVisible].sort();
    if (
      sortedNext.length === sortedDefault.length &&
      sortedNext.every((v, i) => v === sortedDefault[i])
    ) {
      params.delete(fullKey);
    } else {
      params.set(fullKey, sortedNext.join(","));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const reset = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(fullKey);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const hiddenCount = columns.length - current.size;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5",
            hiddenCount > 0 && "border-solid bg-accent/30"
          )}
        >
          <Settings2 className="size-3.5" />
          <span className="hidden sm:inline">Columnas</span>
          {hiddenCount > 0 && (
            <span className="rounded-sm bg-muted px-1 text-[10px] tabular-nums">
              {columns.length - hiddenCount}/{columns.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Mostrar columnas
        </div>
        <Separator className="my-1" />
        <div className="max-h-72 overflow-y-auto">
          {columns.map((col) => {
            const isSel = current.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                disabled={col.alwaysVisible}
                onClick={() => toggle(col.key, col.alwaysVisible)}
                className={cn(
                  "flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  col.alwaysVisible && "cursor-not-allowed opacity-50"
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
                <span className="flex-1 truncate text-left">{col.label}</span>
              </button>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-center text-xs"
              onClick={reset}
            >
              Restaurar default
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
