import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { RowCheckbox, SelectAllCheckbox } from "./row-checkbox";

/** Magic key para la columna de selección. No usar en column defs externas. */
const SELECT_COLUMN_KEY = "__select";

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────
export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide en mobile (< sm). La versión mobile usa mobileCard. */
  hideOnMobile?: boolean;
  align?: "left" | "right" | "center";
  /** Si es `true`, renderiza el header como link ordenable (requiere `sortHref`). */
  sortable?: boolean;
  /** Columna oculta por default. El usuario puede togglearla vía TableViewOptions. */
  defaultHidden?: boolean;
  /** Siempre visible (no se puede ocultar). */
  alwaysVisible?: boolean;
  /**
   * Agregado para el footer de totales. Recibe las filas renderizadas (de la
   * página actual si hay paginación) y devuelve el nodo a mostrar en `<tfoot>`.
   * Si al menos una columna define `summary`, la tabla renderiza el footer.
   */
  summary?: (rows: T[]) => React.ReactNode;
}

export interface DataTableSort {
  key: string;
  dir: "asc" | "desc";
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  mobileCard?: (row: T, index: number) => React.ReactNode;
  emptyState?: {
    icon: LucideIcon;
    title: string;
    description?: string;
  };
  rowKey?: (row: T, index: number) => string | number;
  className?: string;
  caption?: string;

  // ── Interactividad (server-rendered via Links) ──
  /** Sort actual — si está presente, los headers con `sortable` se convierten en links. */
  sort?: DataTableSort | null;
  /** Devuelve href para togglear sort (asc/desc/null) de la columna `key`. */
  sortHref?: (key: string, nextDir: "asc" | "desc" | null) => string;
  /** Fila clickable — renderiza los row wrappers como links. Si retorna null, no es clickable. */
  rowHref?: (row: T) => string | null | undefined;
  /** Columnas visibles (control externo, ej: via URL param). */
  visibleKeys?: string[];

  // ── UX ──
  /** Header pegado arriba al hacer scroll vertical. Default: true. */
  stickyHeader?: boolean;
  /** Primera columna pegada al hacer scroll horizontal. Default: false. */
  stickyFirstColumn?: boolean;
  /** Altura máxima (habilita scroll vertical). */
  maxHeight?: string;
  /** Densidad de fila. Default: "normal". */
  density?: "compact" | "normal";

  // ── Selection multi-fila ──
  /**
   * Habilita selección. Pasa `rowId` que devuelve un string estable por fila.
   * Requiere `<SelectionProvider>` en el ancestro (DataView lo maneja).
   */
  selectable?: {
    rowId: (row: T) => string;
  };

  // ── Footer de totales ──
  /**
   * Etiqueta que va en la primera columna del footer (ej. "Total", "Suma").
   * Si no se pasa, se muestra el conteo de filas. El footer sólo se renderiza
   * si al menos una columna define `summary` en su `DataTableColumn`.
   */
  summaryLabel?: React.ReactNode;
}

/**
 * DataTable v2 — responsive, server component, dinámico vía URL.
 *
 * Este es el único componente de tabla de la app. Para features interactivas
 * mutables (column visibility, view options) usa composiciones con los helpers
 * client-side del módulo v2.
 */
export function DataTable<T>({
  data,
  columns,
  mobileCard,
  emptyState,
  rowKey,
  className,
  caption,
  sort,
  sortHref,
  rowHref,
  visibleKeys,
  stickyHeader = true,
  stickyFirstColumn = false,
  maxHeight,
  density = "normal",
  selectable,
  summaryLabel,
}: DataTableProps<T>) {
  // Empty state
  if (!data || data.length === 0) {
    if (emptyState) {
      return (
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
        />
      );
    }
    return null;
  }

  const getKey = (row: T, i: number) => (rowKey ? rowKey(row, i) : i);
  const alignClass = (a?: DataTableColumn<T>["align"]) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "";
  const cellPadding = density === "compact" ? "py-1.5" : "py-2.5";

  // Filtrado de columnas visibles
  const userColumns = columns.filter((c) => {
    if (c.alwaysVisible) return true;
    if (visibleKeys) return visibleKeys.includes(c.key);
    return !c.defaultHidden;
  });

  // Si hay selección, inyecta la columna checkbox al inicio.
  const rowIds = selectable ? data.map((r) => selectable.rowId(r)) : [];
  const effectiveColumns: DataTableColumn<T>[] = selectable
    ? [
        {
          key: SELECT_COLUMN_KEY,
          header: "",
          alwaysVisible: true,
          className: "w-9 px-0",
          align: "center",
          cell: (row) => (
            <RowCheckbox rowId={selectable.rowId(row)} />
          ),
        },
        ...userColumns,
      ]
    : userColumns;

  // Toggle de sort: null → desc → asc → null
  const nextSortDir = (
    key: string
  ): "asc" | "desc" | null => {
    if (!sort || sort.key !== key) return "desc";
    if (sort.dir === "desc") return "asc";
    return null;
  };

  const renderHeader = (col: DataTableColumn<T>, index: number) => {
    const isSelectCol = col.key === SELECT_COLUMN_KEY;
    if (isSelectCol) {
      return (
        <TableHead
          key={col.key}
          className={cn(
            "w-9 px-0 text-center",
            stickyHeader &&
              "sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]"
          )}
        >
          <SelectAllCheckbox ids={rowIds} />
        </TableHead>
      );
    }
    const isSorted = sort?.key === col.key;
    const dir = isSorted ? sort?.dir : null;
    const isSortable = col.sortable && sortHref;
    const isFirstSticky = stickyFirstColumn && index === 0;

    const headerInner = (
      <span
        className={cn(
          "flex items-center gap-1 text-xs font-semibold uppercase tracking-wide",
          col.align === "right" && "justify-end",
          col.align === "center" && "justify-center"
        )}
      >
        <span className="text-muted-foreground">{col.header}</span>
        {isSortable &&
          (isSorted ? (
            dir === "asc" ? (
              <ArrowUp className="size-3 text-foreground" />
            ) : (
              <ArrowDown className="size-3 text-foreground" />
            )
          ) : (
            <ChevronsUpDown className="size-3 opacity-40" />
          ))}
      </span>
    );

    return (
      <TableHead
        key={col.key}
        aria-sort={
          isSorted ? (dir === "asc" ? "ascending" : "descending") : "none"
        }
        className={cn(
          alignClass(col.align),
          col.hideOnMobile && "hidden md:table-cell",
          stickyHeader &&
            "sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]",
          isFirstSticky &&
            "sticky left-0 z-20 bg-card shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)]",
          "whitespace-nowrap",
          col.className
        )}
      >
        {isSortable ? (
          <a
            href={sortHref!(col.key, nextSortDir(col.key))}
            className="-mx-2 flex rounded px-2 py-1 transition-colors hover:bg-accent/60"
            aria-label={`Ordenar por ${col.header}`}
          >
            {headerInner}
          </a>
        ) : (
          headerInner
        )}
      </TableHead>
    );
  };

  const renderRow = (row: T, i: number) => {
    const key = getKey(row, i);
    const href = rowHref ? rowHref(row) : null;
    const clickable = Boolean(href);

    return (
      <TableRow
        key={key}
        data-slot="data-table-row"
        className={cn(
          clickable &&
            "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
        )}
      >
        {effectiveColumns.map((col, colIdx) => {
          const isFirstSticky = stickyFirstColumn && colIdx === 0;
          const isSelectCol = col.key === SELECT_COLUMN_KEY;
          // La columna de selección no se envuelve en el link de la fila —
          // clickear el checkbox debe togglear selección, no navegar.
          const cellContent = clickable && !isSelectCol ? (
            <a
              href={href!}
              className="block -m-2 p-2 focus-visible:outline-none"
              tabIndex={colIdx === 0 ? 0 : -1}
              aria-label={colIdx === 0 ? "Abrir detalle" : undefined}
            >
              {col.cell(row)}
            </a>
          ) : (
            col.cell(row)
          );
          return (
            <TableCell
              key={col.key}
              className={cn(
                alignClass(col.align),
                col.hideOnMobile && "hidden md:table-cell",
                isFirstSticky && "sticky left-0 z-[5] bg-card",
                cellPadding,
                col.className
              )}
            >
              {cellContent}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  const hasSummary =
    effectiveColumns.some((c) => typeof c.summary === "function") ||
    summaryLabel != null;

  const renderFooter = () => {
    if (!hasSummary) return null;
    return (
      <tfoot>
        <TableRow className="border-t-2 border-border bg-muted/30 font-semibold hover:bg-muted/30">
          {effectiveColumns.map((col, colIdx) => {
            // La primera columna non-select muestra el label del footer.
            const isSelectCol = col.key === SELECT_COLUMN_KEY;
            const isFirstLabelCol =
              !isSelectCol &&
              effectiveColumns.findIndex(
                (c) => c.key !== SELECT_COLUMN_KEY
              ) === colIdx;
            const content = col.summary ? (
              col.summary(data)
            ) : isFirstLabelCol ? (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {summaryLabel ?? `Total · ${data.length}`}
              </span>
            ) : null;
            return (
              <TableCell
                key={col.key}
                className={cn(
                  alignClass(col.align),
                  col.hideOnMobile && "hidden md:table-cell",
                  "py-2 tabular-nums",
                  col.className
                )}
              >
                {content}
              </TableCell>
            );
          })}
        </TableRow>
      </tfoot>
    );
  };

  const tableEl = (
    <Table>
      {caption && <caption className="sr-only">{caption}</caption>}
      <TableHeader>
        <TableRow>
          {effectiveColumns.map((col, i) => renderHeader(col, i))}
        </TableRow>
      </TableHeader>
      <TableBody>{data.map((row, i) => renderRow(row, i))}</TableBody>
      {renderFooter()}
    </Table>
  );

  return (
    <>
      {/* Mobile: card list */}
      {mobileCard && (
        <div className={cn("flex flex-col gap-2 sm:hidden", className)}>
          {data.map((row, i) => {
            const key = getKey(row, i);
            const href = rowHref ? rowHref(row) : null;
            const content = mobileCard(row, i);
            return (
              <React.Fragment key={key}>
                {href ? (
                  <a
                    href={href}
                    className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    {content}
                  </a>
                ) : (
                  content
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Desktop: table plana sin wrapper (sin doble-caja).
          - Sin Card, sin border-y, sin background extra.
          - Los TableRow ya tienen border-b de shadcn, así que se leen las
            filas solas sin ruido visual.
          - La primera celda de cada row tiene pl-0 para alinear con el
            texto del CardHeader (que usa px-6), y la última celda pr-0
            para simetría. */}
      <div
        data-slot="data-table"
        className={cn(
          "relative w-full",
          "[&_th:first-child]:pl-0 [&_th:last-child]:pr-0",
          "[&_td:first-child]:pl-0 [&_td:last-child]:pr-0",
          mobileCard ? "hidden sm:block" : "",
          className
        )}
        style={
          maxHeight
            ? { maxHeight, overflow: "auto" }
            : undefined
        }
      >
        {tableEl}
      </div>
    </>
  );
}
