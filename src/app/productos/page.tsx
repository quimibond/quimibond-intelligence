import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Flame,
  Package,
  PackageCheck,
  TrendingUp,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataView,
  DataTableToolbar,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  SectionNav,
  MobileCard,
  Currency,
  DateDisplay,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
  type DataViewChartSpec,
  type DataViewMode,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getProductsKpis,
  getInventoryPage,
  getProductCategoryOptions,
  getTopMoversPage,
  getDeadStockPage,
  getTopMarginProducts,
  type ReorderRow,
  type TopMoverRow,
  type DeadStockRow,
  type TopMarginProductRow,
} from "@/lib/queries/products";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import { formatNumber } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Productos" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Construye un href para /productos preservando el resto de los searchParams
 * y actualizando (o borrando) las claves pasadas en `updates`.
 */
function buildProductosHref(
  sp: SearchParams,
  updates: Record<string, string | null>
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `/productos?${s}` : "/productos";
}

function parseViewParam(
  sp: SearchParams,
  key: string
): DataViewMode {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "chart" ? "chart" : "table";
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Productos"
        subtitle="¿Qué tengo en inventario, qué rota bien y qué está muerto?"
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "inventory", label: "Inventario" },
          { id: "top-movers", label: "Top movers" },
          { id: "top-margin", label: "Top margen" },
          { id: "dead-stock", label: "Dead stock" },
        ]}
      />

      <section id="kpis" className="scroll-mt-24">
      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <ProductsHeroKpis />
      </Suspense>
      </section>

      {/* Inventario — tabla con filtros completos */}
      <section id="inventory" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Inventario</CardTitle>
            <p className="text-xs text-muted-foreground">
              Busca por referencia o nombre y filtra por estado de reorden o
              categoría. Por defecto muestra stockout, urgente 14d y reorder
              30d.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="inv_"
              columns={inventoryViewColumns}
            />
            <TableExportButton filename="inventory" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={null}>
            <InventoryToolbar />
          </Suspense>
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <ReorderTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="top-movers" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Top movers (90 días)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos con mayor volumen vendido.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="tm_"
              columns={topMoverViewColumns}
            />
            <TableExportButton filename="top-movers" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="tm_"
            searchPlaceholder="Ref o nombre…"
          />
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <TopMoversTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="top-margin" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Top margen (revenue ponderado)
            </CardTitle>
          </div>
          <TableExportButton filename="top-margin" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <TopMarginTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="dead-stock" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Stock muerto (sin movimiento)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos sin venta por largo tiempo. Ordena por valor, días o
              revenue lifetime.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="ds_"
              columns={deadStockViewColumns}
            />
            <TableExportButton filename="dead-stock" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="ds_"
            searchPlaceholder="Ref o nombre…"
          />
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <DeadStockTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero KPIs
// ──────────────────────────────────────────────────────────────────────────
async function ProductsHeroKpis() {
  const k = await getProductsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Catálogo activo"
        value={k.catalogActive}
        format="number"
        icon={Package}
      />
      <KpiCard
        title="Por reordenar"
        value={k.needsReorder}
        format="number"
        icon={Flame}
        subtitle="urgente + 30d + stockout"
        tone={k.needsReorder > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Sin movimiento"
        value={k.noMovementValue}
        format="currency"
        compact
        icon={Archive}
        subtitle={`${k.noMovementCount} productos`}
        tone="warning"
      />
      <KpiCard
        title="Margen promedio"
        value={k.avgMarginPct}
        format="percent"
        icon={TrendingUp}
        subtitle="bruto"
        tone={k.avgMarginPct >= 30 ? "success" : "warning"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder table
// ──────────────────────────────────────────────────────────────────────────
const reorderVariant: Record<string, "critical" | "warning" | "info"> = {
  stockout: "critical",
  urgent_14d: "critical",
  reorder_30d: "warning",
};
const reorderLabel: Record<string, string> = {
  stockout: "STOCKOUT",
  urgent_14d: "≤ 14 días",
  reorder_30d: "≤ 30 días",
};

const inventoryViewColumns = [
  { key: "ref", label: "Ref", alwaysVisible: true },
  { key: "name", label: "Producto" },
  { key: "category", label: "Categoría", defaultHidden: true },
  { key: "status", label: "Estado" },
  { key: "available", label: "Disponible" },
  { key: "stock", label: "Stock físico", defaultHidden: true },
  { key: "qty_sold", label: "Vendido 90d" },
  { key: "run_rate", label: "Daily run rate" },
  { key: "days_of_stock", label: "Días stock", defaultHidden: true },
  { key: "customers", label: "# clientes", defaultHidden: true },
  { key: "last_sale", label: "Última venta", defaultHidden: true },
];

const reorderColumns: DataTableColumn<ReorderRow>[] = [
  {
    key: "ref",
    header: "Ref",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
  },
  {
    key: "name",
    header: "Producto",
    sortable: true,
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
  },
  {
    key: "category",
    header: "Categoría",
    defaultHidden: true,
    cell: (r) => (
      <span className="truncate text-xs text-muted-foreground">
        {r.category ?? "—"}
      </span>
    ),
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={reorderVariant[r.reorder_status] ?? "warning"}>
        {reorderLabel[r.reorder_status] ?? r.reorder_status}
      </Badge>
    ),
  },
  {
    key: "available",
    header: "Disponible",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.available_qty)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "stock",
    header: "Stock físico",
    defaultHidden: true,
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.stock_qty)}</span>
    ),
    align: "right",
  },
  {
    key: "qty_sold",
    header: "Vendido 90d",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.qty_sold_90d)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "days_of_stock",
    header: "Días stock",
    sortable: true,
    defaultHidden: true,
    cell: (r) =>
      r.days_of_stock != null ? (
        <span
          className={`tabular-nums ${
            r.days_of_stock <= 14
              ? "font-bold text-danger"
              : r.days_of_stock <= 30
                ? "text-warning"
                : ""
          }`}
        >
          {Math.round(r.days_of_stock)}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "run_rate",
    header: "Daily rate",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.daily_run_rate != null ? r.daily_run_rate.toFixed(1) : "—"}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "customers",
    header: "# clientes",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <span className="tabular-nums">{r.customers_12m}</span>,
    align: "right",
  },
  {
    key: "last_sale",
    header: "Última venta",
    defaultHidden: true,
    cell: (r) => <DateDisplay date={r.last_sale_date} />,
  },
];

async function InventoryToolbar() {
  const categories = await getProductCategoryOptions();
  return (
    <DataTableToolbar
      paramPrefix="inv_"
      searchPlaceholder="Ref o nombre…"
      facets={[
        {
          key: "status",
          label: "Estado",
          options: [
            { value: "stockout", label: "Stockout" },
            { value: "urgent_14d", label: "Urgente (14d)" },
            { value: "reorder_30d", label: "Reorden (30d)" },
            { value: "healthy", label: "Saludable" },
            { value: "excess", label: "Exceso" },
            { value: "no_movement", label: "Sin movimiento" },
          ],
        },
        {
          key: "category",
          label: "Categoría",
          options: categories.map((c) => ({ value: c, label: c })),
        },
      ]}
    />
  );
}

async function ReorderTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "inv_",
    facetKeys: ["status", "category"],
    defaultSize: 25,
    defaultSort: "-run_rate",
  });
  const { rows, total } = await getInventoryPage({
    ...params,
    status: params.facets.status,
    category: params.facets.category,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "inv_");
  const sortHref = makeSortHref({
    pathname: "/productos",
    searchParams,
    paramPrefix: "inv_",
  });
  const view = parseViewParam(searchParams, "inv_view");
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Sin productos"
        description="Ajusta los filtros para ver el inventario."
        compact
      />
    );
  }
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "product_ref",
    topN: 15,
    layout: "horizontal",
    series: [{ dataKey: "qty_sold_90d", label: "Vendido 90d" }],
    valueFormat: "number",
    colorBy: "reorder_status",
    colorMap: {
      stockout: "var(--destructive)",
      urgent_14d: "var(--chart-4)",
      reorder_30d: "var(--chart-3)",
      healthy: "var(--chart-2)",
      excess: "var(--chart-5)",
      no_movement: "var(--muted-foreground)",
    },
    height: 480,
  };
  return (
    <>
      <DataView
        data={rows}
        columns={reorderColumns}
        chart={chart}
        view={view}
        viewHref={(next) =>
          buildProductosHref(searchParams, {
            inv_view: next === "chart" ? "chart" : null,
          })
        }
        rowKey={(r, i) => `${r.product_ref ?? "p"}-${i}`}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={r.product_name ?? r.product_ref ?? "—"}
            subtitle={r.product_ref ?? r.category ?? undefined}
            badge={
              <Badge variant={reorderVariant[r.reorder_status] ?? "warning"}>
                {reorderLabel[r.reorder_status] ?? r.reorder_status}
              </Badge>
            }
            fields={[
              {
                label: "Disponible",
                value: Math.round(r.available_qty),
              },
              {
                label: "Días stock",
                value:
                  r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
                className:
                  r.days_of_stock != null && r.days_of_stock <= 14
                    ? "text-danger font-bold"
                    : "",
              },
              {
                label: "Vendido 90d",
                value: Math.round(r.qty_sold_90d),
              },
              {
                label: "Daily rate",
                value:
                  r.daily_run_rate != null
                    ? r.daily_run_rate.toFixed(1)
                    : "—",
              },
            ]}
          />
        )}
      />
      {view === "table" && (
        <DataTablePagination
          paramPrefix="inv_"
          total={total}
          page={params.page}
          pageSize={params.size}
          unit="productos"
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top movers
// ──────────────────────────────────────────────────────────────────────────
const topMoverViewColumns = [
  { key: "ref", label: "Ref", alwaysVisible: true },
  { key: "name", label: "Producto" },
  { key: "qty_90d", label: "Vendido 90d" },
  { key: "qty_180d", label: "Vendido 180d", defaultHidden: true },
  { key: "qty_365d", label: "Vendido 365d", defaultHidden: true },
  { key: "customers", label: "# clientes" },
  { key: "run_rate", label: "Daily run rate", defaultHidden: true },
  { key: "days_stock", label: "Días stock" },
  { key: "stock_value", label: "Valor inventario", defaultHidden: true },
  { key: "turnover", label: "Rotación anual", defaultHidden: true },
];

const topMoverColumns: DataTableColumn<TopMoverRow>[] = [
  {
    key: "ref",
    header: "Ref",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
  },
  {
    key: "name",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "qty_90d",
    header: "Vendido 90d",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        {formatNumber(Math.round(r.qty_sold_90d))}
      </span>
    ),
    align: "right",
  },
  {
    key: "qty_180d",
    header: "180d",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {formatNumber(Math.round(r.qty_sold_180d))}
      </span>
    ),
    align: "right",
  },
  {
    key: "qty_365d",
    header: "365d",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {formatNumber(Math.round(r.qty_sold_365d))}
      </span>
    ),
    align: "right",
  },
  {
    key: "customers",
    header: "Clientes",
    sortable: true,
    cell: (r) => <span className="tabular-nums">{r.customers_12m}</span>,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "run_rate",
    header: "Run rate",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.daily_run_rate != null ? r.daily_run_rate.toFixed(1) : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "days_stock",
    header: "Días stock",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.days_of_stock != null ? Math.round(r.days_of_stock) : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "stock_value",
    header: "Inventario",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <Currency amount={r.stock_value} compact />,
    align: "right",
  },
  {
    key: "turnover",
    header: "Rotación",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.annual_turnover != null ? r.annual_turnover.toFixed(1) : "—"}
      </span>
    ),
    align: "right",
  },
];

async function TopMoversTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "tm_",
    defaultSize: 25,
    defaultSort: "-qty_90d",
  });
  const { rows, total } = await getTopMoversPage(params);
  const visibleKeys = parseVisibleKeys(searchParams, "tm_");
  const sortHref = makeSortHref({
    pathname: "/productos",
    searchParams,
    paramPrefix: "tm_",
  });
  const view = parseViewParam(searchParams, "tm_view");
  const chart: DataViewChartSpec = {
    type: "composed",
    xKey: "product_ref",
    topN: 15,
    series: [
      {
        dataKey: "qty_sold_90d",
        label: "Vendido 90d",
        kind: "bar",
        yAxisId: "left",
      },
      {
        dataKey: "annual_turnover",
        label: "Rotación anual",
        kind: "line",
        yAxisId: "right",
        color: "var(--chart-4)",
      },
    ],
    valueFormat: "number",
    secondaryValueFormat: "decimal-1",
  };
  return (
    <>
    <DataView
      data={rows}
      columns={topMoverColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildProductosHref(searchParams, {
          tm_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r, i) => `${r.product_ref ?? "tm"}-${i}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          fields={[
            { label: "90d", value: formatNumber(Math.round(r.qty_sold_90d)) },
            { label: "Clientes", value: r.customers_12m },
            {
              label: "Días stock",
              value:
                r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
            },
            {
              label: "Stock $",
              value: <Currency amount={r.stock_value} compact />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Activity,
        title: "Sin top movers",
        description: "No hay productos con ventas recientes.",
      }}
    />
    {view === "table" && (
      <DataTablePagination
        paramPrefix="tm_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="productos"
      />
    )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top margin
// ──────────────────────────────────────────────────────────────────────────
const topMarginColumns: DataTableColumn<TopMarginProductRow>[] = [
  {
    key: "ref",
    header: "Ref",
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
  },
  {
    key: "name",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "revenue",
    header: "Revenue",
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "margin",
    header: "Margen %",
    cell: (r) => (
      <span
        className={`font-semibold ${
          r.weighted_margin_pct < 0
            ? "text-danger"
            : r.weighted_margin_pct >= 30
              ? "text-success"
              : r.weighted_margin_pct >= 15
                ? "text-warning"
                : "text-muted-foreground"
        }`}
        title={
          r.weighted_margin_pct < 0
            ? "PÉRDIDA: el producto se vende bajo costo."
            : "Margen real = (price − cost) / price. Cost desde BOM o standard_price. Ex-markup values (anteriormente tabla mostraba markup%, ahora convertido a margen real)."
        }
      >
        {r.weighted_margin_pct < 0 && "⚠ "}
        {r.weighted_margin_pct.toFixed(1)}%
      </span>
    ),
    align: "right",
  },
  {
    key: "customers",
    header: "Clientes",
    cell: (r) => r.customers,
    align: "right",
    hideOnMobile: true,
  },
];

async function TopMarginTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rows = await getTopMarginProducts(15);
  const view = parseViewParam(searchParams, "tmg_view");
  const chart: DataViewChartSpec = {
    type: "composed",
    xKey: "product_ref",
    topN: 15,
    series: [
      {
        dataKey: "total_revenue",
        label: "Revenue",
        kind: "bar",
        yAxisId: "left",
      },
      {
        dataKey: "weighted_margin_pct",
        label: "Margen %",
        kind: "line",
        yAxisId: "right",
        color: "var(--chart-4)",
      },
    ],
    valueFormat: "currency-compact",
    secondaryValueFormat: "percent",
  };
  return (
    <DataView
      data={rows}
      columns={topMarginColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildProductosHref(searchParams, {
          tmg_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r, i) => `${r.product_ref ?? "m"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          badge={
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                r.weighted_margin_pct < 0
                  ? "bg-danger/15 text-danger-foreground"
                  : r.weighted_margin_pct >= 30
                    ? "bg-success/15 text-success-foreground"
                    : r.weighted_margin_pct >= 15
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-muted text-muted-foreground"
              }`}
            >
              {r.weighted_margin_pct < 0 && "⚠ "}
              {r.weighted_margin_pct.toFixed(1)}%
            </span>
          }
          fields={[
            {
              label: "Revenue",
              value: <Currency amount={r.total_revenue} compact />,
            },
            { label: "Clientes", value: r.customers },
          ]}
        />
      )}
      emptyState={{
        icon: TrendingUp,
        title: "Sin datos de margen",
        description: "No hay datos en product_margin_analysis.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dead stock
// ──────────────────────────────────────────────────────────────────────────
const deadStockViewColumns = [
  { key: "ref", label: "Ref", alwaysVisible: true },
  { key: "name", label: "Producto" },
  { key: "days", label: "Días sin venta" },
  { key: "stock", label: "Stock", defaultHidden: true },
  { key: "value", label: "Valor" },
  { key: "last_sale", label: "Última venta", defaultHidden: true },
  { key: "customers", label: "# clientes históricos", defaultHidden: true },
  { key: "lifetime", label: "Revenue histórico" },
];

const deadStockColumns: DataTableColumn<DeadStockRow>[] = [
  {
    key: "ref",
    header: "Ref",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
  },
  {
    key: "name",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
  },
  {
    key: "days",
    header: "Días sin venta",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold tabular-nums text-warning-foreground">
        {r.days_since_last_sale}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "stock",
    header: "Stock",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.stock_qty)}</span>
    ),
    align: "right",
  },
  {
    key: "value",
    header: "Valor",
    sortable: true,
    cell: (r) => <Currency amount={r.inventory_value} compact />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold text-warning">
        <Currency
          amount={rows.reduce((s, r) => s + (r.inventory_value ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "last_sale",
    header: "Última venta",
    defaultHidden: true,
    cell: (r) => <DateDisplay date={r.last_sale_date} />,
  },
  {
    key: "customers",
    header: "# clientes",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">{r.historical_customers}</span>
    ),
    align: "right",
  },
  {
    key: "lifetime",
    header: "Revenue histórico",
    sortable: true,
    cell: (r) => <Currency amount={r.lifetime_revenue} compact />,
    align: "right",
    hideOnMobile: true,
  },
];

async function DeadStockTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "ds_",
    defaultSize: 25,
    defaultSort: "-value",
  });
  const { rows, total } = await getDeadStockPage(params);
  const visibleKeys = parseVisibleKeys(searchParams, "ds_");
  const sortHref = makeSortHref({
    pathname: "/productos",
    searchParams,
    paramPrefix: "ds_",
  });
  const view = parseViewParam(searchParams, "ds_view");
  const chartRows = rows.map((r) => ({
    ...r,
    revenue_bucket:
      r.lifetime_revenue > 0 ? "Tuvo ventas" : "Sin historia",
  }));
  const chart: DataViewChartSpec = {
    type: "scatter",
    xKey: "days_since_last_sale",
    yKey: "inventory_value",
    sizeKey: "stock_qty",
    series: [
      { dataKey: "days_since_last_sale", label: "Días sin venta" },
      { dataKey: "inventory_value", label: "Valor" },
    ],
    valueFormat: "number",
    secondaryValueFormat: "currency-compact",
    colorBy: "revenue_bucket",
    colorMap: {
      "Tuvo ventas": "var(--chart-2)",
      "Sin historia": "var(--destructive)",
    },
    referenceLine: {
      value: 180,
      axis: "x",
      label: "180d crítico",
    },
  };
  return (
    <>
    <DataView
      data={chartRows}
      columns={deadStockColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildProductosHref(searchParams, {
          ds_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r, i) => `${r.product_ref ?? "d"}-${i}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          badge={
            <span className="rounded bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
              <Currency amount={r.inventory_value} compact />
            </span>
          }
          fields={[
            { label: "Días sin venta", value: r.days_since_last_sale },
            {
              label: "Stock",
              value: Math.round(r.stock_qty),
            },
            {
              label: "Última venta",
              value: <DateDisplay date={r.last_sale_date} relative />,
            },
            {
              label: "Revenue total",
              value: <Currency amount={r.lifetime_revenue} compact />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Archive,
        title: "Sin stock muerto",
        description: "Todos los productos tienen movimiento reciente.",
      }}
    />
    {view === "table" && (
      <DataTablePagination
        paramPrefix="ds_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="productos"
      />
    )}
    </>
  );
}
