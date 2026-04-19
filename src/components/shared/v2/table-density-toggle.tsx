"use client";

import * as React from "react";
import { Rows2, Rows4 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Density = "normal" | "compact";

const STORAGE_KEY = "qb:table-density";
const ATTR = "data-table-density";

function applyDensity(d: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(ATTR, d);
}

/**
 * TableDensityToggle — control global de densidad de filas en todas las
 * tablas v2. Persiste la preferencia en localStorage y escribe un data-
 * attribute en `<html>` que CSS global consume para compactar los td/th.
 *
 * Un solo toggle en la página afecta todas las tablas simultáneamente.
 * Pensado para ir junto a `TableViewOptions` en los headers de sección.
 */
export function TableDensityToggle({
  className,
}: {
  className?: string;
}) {
  const [density, setDensity] = React.useState<Density>("normal");

  // Lee preferencia guardada al montar.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "compact" || saved === "normal") {
        setDensity(saved);
        applyDensity(saved);
      }
    } catch {
      /* silencio: Safari private mode, quota, etc. */
    }
  }, []);

  const change = (next: Density) => {
    setDensity(next);
    applyDensity(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Densidad de filas"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-8 items-center justify-center rounded-md p-0.5",
        className
      )}
    >
      {(["normal", "compact"] as const).map((d) => {
        const active = d === density;
        const Icon = d === "normal" ? Rows2 : Rows4;
        const label = d === "normal" ? "Normal" : "Compacto";
        return (
          <Button
            key={d}
            variant="ghost"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => change(d)}
            className={cn(
              "inline-flex h-auto items-center gap-1.5 rounded px-2 py-1 text-xs font-medium whitespace-nowrap",
              active
                ? "bg-background text-foreground shadow-sm hover:bg-background"
                : "hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
