import type { LucideIcon } from "lucide-react";

import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from "./data-table";
import {
  DataViewChart,
  type DataViewChartSpec,
} from "./data-view-chart";
import {
  DataViewToggle,
  type DataViewMode,
} from "./data-view-toggle";

export type { DataViewMode } from "./data-view-toggle";
export type { DataViewChartSpec, ChartType } from "./data-view-chart";

interface DataViewProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];

  // ── Chart toggle ─────────────────────────────────────────────
  /**
   * Spec de la gráfica. Si no se pasa, solo se renderiza la tabla
   * (sin toggle). Si se pasa, el usuario puede alternar entre
   * Tabla y Gráfica vía URL searchParam `view`.
   */
  chart?: DataViewChartSpec;
  /** Vista actual desde la URL (ej. `searchParams.view`). Default "table". */
  view?: DataViewMode;
  /**
   * Generator para los hrefs del toggle. Preserva el resto de la URL
   * (filters, sort, pagination) — solo cambia el param `view`.
   *
   * Ej:
   * ```ts
   * viewHref={(next) => {
   *   const p = new URLSearchParams(currentSearchParams);
   *   p.set("view", next);
   *   return `?${p.toString()}`;
   * }}
   * ```
   */
  viewHref?: (next: DataViewMode) => string;

  // ── Optional header acción al lado del toggle ────────────────
  /** Extra content a la derecha del toggle (ej. export button). */
  toolbar?: React.ReactNode;

  // ── DataTable passthrough ────────────────────────────────────
  mobileCard?: (row: T, index: number) => React.ReactNode;
  emptyState?: {
    icon: LucideIcon;
    title: string;
    description?: string;
  };
  rowKey?: (row: T, index: number) => string | number;
  className?: string;
  caption?: string;
  sort?: DataTableSort | null;
  sortHref?: (key: string, nextDir: "asc" | "desc" | null) => string;
  rowHref?: (row: T) => string | null | undefined;
  visibleKeys?: string[];
  stickyHeader?: boolean;
  stickyFirstColumn?: boolean;
  maxHeight?: string;
  density?: "compact" | "normal";
}

/**
 * DataView — tabla con toggle opcional a gráfica.
 *
 * Server component: decide qué renderizar en base al param `view` de la URL.
 * Usa `DataTable` v2 para el modo tabla y `DataViewChart` (client) para el
 * modo gráfica. Si `chart` es undefined, se comporta exactamente como
 * `DataTable` pero con un slot `toolbar`.
 *
 * @example
 * ```tsx
 * const chart: DataViewChartSpec = {
 *   type: "bar",
 *   xKey: "product",
 *   series: [{ dataKey: "revenue_90d", label: "Revenue 90d" }],
 *   valueFormatter: formatCurrencyCompact,
 * };
 *
 * <DataView
 *   data={topMovers}
 *   columns={columns}
 *   chart={chart}
 *   view={searchParams.view === "chart" ? "chart" : "table"}
 *   viewHref={(v) => buildHref({ view: v })}
 * />
 * ```
 */
export function DataView<T>({
  data,
  columns,
  chart,
  view = "table",
  viewHref,
  toolbar,
  ...tableProps
}: DataViewProps<T>) {
  const hasChart = Boolean(chart);
  const currentView: DataViewMode = hasChart ? view : "table";

  return (
    <div className="space-y-3">
      {(hasChart || toolbar) && (
        <div className="flex items-center justify-between gap-2">
          {hasChart && viewHref ? (
            <DataViewToggle view={currentView} viewHref={viewHref} />
          ) : (
            <div />
          )}
          {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
        </div>
      )}

      {currentView === "chart" && chart ? (
        <DataViewChart
          data={data as Record<string, unknown>[]}
          chart={chart}
        />
      ) : (
        <DataTable data={data} columns={columns} {...tableProps} />
      )}
    </div>
  );
}
