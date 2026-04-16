"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSelection } from "./selection-context";

export interface BatchAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Variant del botón. Default "outline". `destructive` para acciones peligrosas. */
  variant?: "outline" | "default" | "destructive" | "secondary";
  /** Handler async — recibe los IDs seleccionados. */
  onRun: (ids: string[]) => void | Promise<void>;
  /** Si true, limpia la selección tras ejecutar (default true). */
  clearAfter?: boolean;
}

interface BatchActionBarProps {
  actions: BatchAction[];
  /** Texto para el conteo. Default: "seleccionadas". */
  label?: string;
  className?: string;
}

/**
 * Barra flotante de acciones en batch — aparece cuando hay al menos 1 fila
 * seleccionada. Posicionada sticky al fondo del viewport en mobile, inline
 * en desktop (dentro del flujo de la sección).
 */
export function BatchActionBar({
  actions,
  label = "seleccionadas",
  className,
}: BatchActionBarProps) {
  const { count, selected, clear } = useSelection();
  const [running, setRunning] = React.useState<string | null>(null);

  if (count === 0) return null;

  const runAction = async (action: BatchAction) => {
    setRunning(action.id);
    try {
      await action.onRun(Array.from(selected));
      if (action.clearAfter !== false) clear();
    } finally {
      setRunning(null);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Acciones en lote"
      className={cn(
        "sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-full",
        "border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur",
        "supports-[backdrop-filter]:bg-background/80",
        className
      )}
    >
      <span className="pl-1 text-xs font-medium tabular-nums">
        {count} {label}
      </span>
      <div className="h-4 w-px bg-border" aria-hidden />
      <div className="flex flex-wrap items-center gap-1">
        {actions.map((a) => {
          const Icon = a.icon;
          const isRunning = running === a.id;
          return (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={a.variant ?? "outline"}
              className="h-7 gap-1.5 text-xs"
              disabled={running !== null}
              onClick={() => runAction(a)}
            >
              {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
              {isRunning ? "…" : a.label}
            </Button>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto h-7 gap-1 text-xs text-muted-foreground"
        onClick={clear}
        aria-label="Limpiar selección"
      >
        <X className="size-3.5" aria-hidden />
        Limpiar
      </Button>
    </div>
  );
}
