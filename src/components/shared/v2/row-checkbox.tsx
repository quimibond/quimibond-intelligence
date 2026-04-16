"use client";

import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useSelection } from "./selection-context";

interface RowCheckboxProps {
  rowId: string;
  label?: string;
  className?: string;
}

/** Checkbox individual de fila — conectado al SelectionProvider vía context. */
export function RowCheckbox({ rowId, label, className }: RowCheckboxProps) {
  const { isSelected, toggle } = useSelection();
  const checked = isSelected(rowId);
  return (
    <Checkbox
      className={cn("translate-y-[1px]", className)}
      checked={checked}
      onCheckedChange={() => toggle(rowId)}
      aria-label={label ?? `Seleccionar fila ${rowId}`}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface SelectAllCheckboxProps {
  /** IDs del conjunto visible (página actual). */
  ids: string[];
  label?: string;
  className?: string;
}

/** Checkbox master — marca/desmarca todos los IDs visibles. Soporta indeterminate. */
export function SelectAllCheckbox({
  ids,
  label,
  className,
}: SelectAllCheckboxProps) {
  const { isSelected, setMany } = useSelection();
  const total = ids.length;
  const selectedCount = ids.reduce(
    (n, id) => (isSelected(id) ? n + 1 : n),
    0
  );
  const allChecked = total > 0 && selectedCount === total;
  const someChecked = selectedCount > 0 && selectedCount < total;
  const state: boolean | "indeterminate" = allChecked
    ? true
    : someChecked
      ? "indeterminate"
      : false;

  return (
    <Checkbox
      className={cn("translate-y-[1px]", className)}
      checked={state}
      onCheckedChange={(v) => setMany(ids, Boolean(v))}
      aria-label={label ?? "Seleccionar todas las filas visibles"}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
