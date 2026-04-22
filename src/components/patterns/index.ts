// Catálogo canónico de patterns. Ver docs/design-system.md.
// Usar SIEMPRE estos building blocks en nuevas páginas (mobile-first).
// Anteriormente vivía en src/components/shared/v2/ (renombrado 2026-04-19).
export { KpiCard } from "./kpi-card";
export { StatGrid } from "./stat-grid";
export {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from "./data-table";
export {
  DataView,
  type DataViewMode,
  type DataViewChartSpec,
  type ChartType,
  type BatchAction,
} from "./data-view";
export {
  SelectionProvider,
  useSelection,
  useSelectionMaybe,
} from "./selection-context";
export { RowCheckbox, SelectAllCheckbox } from "./row-checkbox";
export { BatchActionBar } from "./batch-action-bar";
export { DataViewChart } from "./data-view-chart";
export { DataViewToggle } from "./data-view-toggle";
export { TableDensityToggle } from "./table-density-toggle";
export { TableViewOptions, type ViewColumn } from "./table-view-options";
export { TableExportButton } from "./table-export-button";
export { makeSortHref } from "./table-sort-href";
export { CompanyLink } from "./company-link";
export { Currency } from "./currency";
export { DateDisplay } from "./date-display";
export { SeverityBadge, type Severity } from "./severity-badge";
export { StatusBadge, type Status } from "./status-badge";
export type { StatusBadgeProps, StatusBadgeDensity, StatusBadgeVariant } from "./status-badge";
export { TrendIndicator } from "./trend-indicator";
export { MetricRow } from "./metric-row";
export { EmptyState } from "./empty-state";
export { MiniChart } from "./mini-chart";
export { FilterBar, type FilterOption } from "./filter-bar";
export {
  DataTableToolbar,
  type DataTableToolbarProps,
  type FacetFilter,
  type FacetOption,
  type DateRangeFilter,
} from "./data-table-toolbar";
export {
  DataTablePagination,
  type DataTablePaginationProps,
} from "./data-table-pagination";
export { BottomSheet } from "./bottom-sheet";
export { MobileCard } from "./mobile-card";
export { PageHeader, type BreadcrumbItem } from "./page-header";
export { ConfirmDialog } from "./confirm-dialog";
export { SectionNav, type SectionNavItem } from "./section-nav";
export { EvidencePackView } from "./evidence-pack";
export { PullToRefresh } from "./pull-to-refresh";
export {
  EvidenceChip,
  type EvidenceType,
  type EvidenceStatus,
} from "./evidence-chip";
export {
  EvidenceTimeline,
  type TimelineEventType,
} from "./evidence-timeline";
export { PredictionCard, PredictionDelta, type PredictionStatus } from "./prediction-card";
export { PersonCard } from "./person-card";
export { InvoiceDetailView } from "./invoice-detail";
export { PageLayout } from "./page-layout";
export { SectionHeader } from "./section-header";
export { LoadingCard, LoadingTable, LoadingList } from "./loading";
export {
  YearSelector,
  parseYearParam,
  type YearValue,
  type YearSelectorProps,
} from "./year-selector";
export { PeriodSelector, type PeriodSelectorProps } from "./period-selector";
export {
  GroupByToggle,
  parseGroupBy,
  groupByTrunc,
  type GroupByTemporal,
  type GroupByToggleProps,
} from "./groupby-toggle";
export { Chart, type ChartProps, type ChartSeries } from "./chart";
export type { ChartType as ChartPrimitiveType } from "./chart";
export { TrendSpark } from "./trend-spark";
export { InboxCard, type InboxCardIssue, type InboxActionCta, type InboxCardSeverity } from "./inbox-card";
export { SwipeStack } from "./swipe-stack";
