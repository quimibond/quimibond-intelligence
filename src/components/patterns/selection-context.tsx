"use client";

import * as React from "react";

/**
 * Contexto de selección multi-fila para tablas.
 *
 * El ID de fila es siempre string para uniformidad — pages pasan
 * `String(row.id)` o `String(row.company_id)` al `rowId`.
 */
interface SelectionContextValue {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setMany: (ids: string[], checked: boolean) => void;
  clear: () => void;
  count: number;
}

const SelectionContext = React.createContext<SelectionContextValue | null>(
  null
);

export function useSelection(): SelectionContextValue {
  const ctx = React.useContext(SelectionContext);
  if (!ctx) {
    throw new Error(
      "useSelection debe usarse dentro de <SelectionProvider>"
    );
  }
  return ctx;
}

/** Hook no-throw — retorna null si no hay provider (para componentes opt-in). */
export function useSelectionMaybe(): SelectionContextValue | null {
  return React.useContext(SelectionContext);
}

export function SelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set()
  );

  const isSelected = React.useCallback(
    (id: string) => selected.has(id),
    [selected]
  );

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = React.useCallback((ids: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const clear = React.useCallback(() => setSelected(new Set()), []);

  const value = React.useMemo<SelectionContextValue>(
    () => ({
      selected,
      isSelected,
      toggle,
      setMany,
      clear,
      count: selected.size,
    }),
    [selected, isSelected, toggle, setMany, clear]
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
