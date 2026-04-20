import { Suspense } from "react";
import {
  AlertTriangle,
  Banknote,
  ShieldAlert,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  PageLayout,
  KpiCard,
  StatGrid,
  PageHeader,
  DataView,
  DataViewChart,
  DataTableToolbar,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  SectionNav,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  StatusBadge,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
  type DataViewChartSpec,
  type DataViewMode,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyMXN } from "@/lib/formatters";

import {
  getPurchasesKpis,
  getSingleSourceRiskPage,
  getSingleSourceSummary,
  getPriceAnomaliesPage,
  getPurchaseOrdersPage,
  getPurchaseBuyerOptions,
  getTopSuppliersPage,
  getSuppliersBlacklistMap,
  type SingleSourceRow,
  type PriceAnomalyRow,
  type RecentPurchaseOrder,
  type TopSupplierRow,
} from "@/lib/queries/operational/purchases";
import {
  getStockoutQueue,
  getSupplierPriceAlerts,
  type StockoutRow,
  type StockoutUrgency,
  type SupplierPriceRow,
  type PriceFlag,
} from "@/lib/queries/analytics";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/_shared/table-params";
import { parsePeriod, periodBoundsIso } from "@/lib/queries/_shared/period-filter";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { PeriodSelector } from "@/components/patterns/period-selector";

export const revalidate = 60; // 60s ISR cache · data freshness OK (pg_cron 15min)
export const metadata = { title: "Compras" };

type SearchParams = Record<string, string | string[] | undefined>;

function buildComprasHref(
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
  return s ? `/compras?${s}` : "/compras";
}

function parseViewParam(sp: SearchParams, key: string): DataViewMode {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "chart" ? "chart" : "table";
}

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <PageLayout>
      <PageHeader
        title="Compras"
        subtitle="¿Qué compré, a quién, a qué precio y qué falta por ordenar?"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source="odoo" coverage="2021+" />
            <a
              href="/compras/price-variance"
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Variancia de precios →
            </a>
            <a
              href="/compras/stockouts"
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Cola de stockouts →
            </a>
            <a
              href="/compras/costos-bom"
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Costos de BOM →
            </a>
          </div>
        }
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "stockouts", label: "Cola reposición" },
          { id: "single-source", label: "Proveedor único" },
          { id: "variance-market", label: "Vs mercado" },
          { id: "price-anomalies", label: "Vs histórico" },
          { id: "top-suppliers", label: "Top proveedores" },
          { id: "orders", label: "Órdenes" },
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
        <PurchasesKpisSection />
      </Suspense>
      </section>

      {/* Cola de reposición — acción directa, lo más urgente arriba */}
      <section id="stockouts" className="scroll-mt-24" data-table-export-root>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Cola de reposición</CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos en riesgo de faltante con proveedor sugerido y
              cantidad recomendada. Lo que debes ordenar YA.
            </p>
          </div>
          <TableExportButton filename="stockouts" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <StockoutsSection searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Single source risk — la sección crítica */}
      <section id="single-source" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Riesgo de proveedor único
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos con concentración alta/crítica de un solo proveedor.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="ss_"
              columns={singleSourceViewColumns}
            />
            <TableExportButton filename="single-source" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="ss_"
            searchPlaceholder="Ref, producto o proveedor…"
            facets={[
              {
                key: "level",
                label: "Nivel",
                options: [
                  { value: "single_source", label: "Single source" },
                  { value: "very_high", label: "Muy alto" },
                  { value: "high", label: "Alto" },
                ],
              },
            ]}
          />
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <SingleSourceTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Variancia vs mercado — comparando proveedores entre sí en el mismo mes */}
      <section
        id="variance-market"
        className="scroll-mt-24"
        data-table-export-root
      >
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Variancia vs mercado
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Líneas pagadas por encima o debajo del benchmark del mes (mismo
              producto comprado a distintos proveedores). Los sobreprecios son
              renegociables; los buenos precios son candidatos para más volumen.
            </p>
          </div>
          <TableExportButton filename="price-variance" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <VarianceMarketSection searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Price anomalies — producto vs su propio histórico */}
      <section id="price-anomalies" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Variancia vs histórico</CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos comprados por arriba o debajo del promedio histórico.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector paramName="pa_period" label="Período" />
            <TableViewOptions
              paramPrefix="pa_"
              columns={priceAnomalyViewColumns}
            />
            <TableExportButton filename="price-anomalies" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="pa_"
            searchPlaceholder="Ref o proveedor…"
            dateRange={{ label: "Última compra" }}
            facets={[
              {
                key: "flag",
                label: "Tendencia",
                options: [
                  { value: "price_above_avg", label: "Precio sobre promedio" },
                  { value: "price_below_avg", label: "Precio bajo promedio" },
                ],
              },
            ]}
          />
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <PriceAnomaliesTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="top-suppliers" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Top proveedores (12m)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranking por gasto total. Ordena por cualquier columna.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector paramName="sup_period" label="Período" />
            <TableViewOptions
              paramPrefix="sup_"
              columns={topSupplierViewColumns}
            />
            <TableExportButton filename="top-suppliers" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="sup_"
            searchPlaceholder="Buscar proveedor…"
          />
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <TopSuppliersTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="orders" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Órdenes de compra</CardTitle>
            <p className="text-xs text-muted-foreground">
              Busca por número o filtra por comprador, estado y fecha.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector paramName="po_period" label="Período" />
            <TableViewOptions
              paramPrefix="po_"
              columns={purchaseOrderViewColumns}
            />
            <TableExportButton filename="purchase-orders" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={null}>
            <PurchaseOrdersToolbar />
          </Suspense>
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <RecentPurchasesTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>
    </PageLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
async function PurchasesKpisSection() {
  const k = await getPurchasesKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Compras del mes"
        value={k.monthTotal}
        format="currency"
        compact
        icon={k.trendPct >= 0 ? TrendingUp : TrendingDown}
        trend={{ value: k.trendPct, good: "down" }}
        subtitle={`${k.poCount} órdenes`}
      />
      <KpiCard
        title="Por pagar"
        value={k.supplierPayable}
        format="currency"
        compact
        icon={Banknote}
        subtitle="cuentas por pagar"
        tone={k.supplierPayable > 0 ? "warning" : "default"}
      />
      <KpiCard
        title="Pagos 30d"
        value={k.pagosProv30d}
        format="currency"
        compact
        icon={Banknote}
        subtitle="a proveedores"
      />
      <KpiCard
        title="Single source"
        value={k.singleSourceSpent}
        format="currency"
        compact
        icon={ShieldAlert}
        subtitle={`${k.singleSourceCount} productos`}
        tone={k.singleSourceCount > 0 ? "danger" : "success"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Single source risk
// ──────────────────────────────────────────────────────────────────────────
const concentrationVariant: Record<string, "critical" | "warning"> = {
  single_source: "critical",
  very_high: "warning",
};
const concentrationLabel: Record<string, string> = {
  single_source: "ÚNICO",
  very_high: "MUY ALTO",
};

const singleSourceViewColumns = [
  { key: "ref", label: "Ref", alwaysVisible: true },
  { key: "name", label: "Producto" },
  { key: "supplier", label: "Proveedor único" },
  { key: "level", label: "Concentración" },
  { key: "share", label: "Share %" },
  { key: "spent", label: "Spent 12m" },
];

const singleSourceColumnsBase: DataTableColumn<SingleSourceRow>[] = [
  {
    key: "ref",
    header: "Ref",
    alwaysVisible: true,
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
    key: "supplier",
    header: "Único proveedor",
    cell: (r) =>
      r.top_supplier_company_id && r.top_supplier_name ? (
        <CompanyLink
          companyId={r.top_supplier_company_id}
          name={r.top_supplier_name}
          truncate
        />
      ) : (
        <span className="truncate">{r.top_supplier_name ?? "—"}</span>
      ),
  },
  {
    key: "level",
    header: "Concentración",
    cell: (r) => (
      <Badge variant={concentrationVariant[r.concentration_level] ?? "warning"}>
        {concentrationLabel[r.concentration_level] ?? r.concentration_level}
      </Badge>
    ),
    hideOnMobile: true,
  },
  {
    key: "share",
    header: "Share",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">
        {Math.round(r.top_supplier_share_pct)}%
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "spent",
    header: "Spent 12m",
    sortable: true,
    cell: (r) => <Currency amount={r.total_spent_12m} compact />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_spent_12m ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
];

async function SingleSourceTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "ss_",
    facetKeys: ["level"],
    defaultSize: 25,
    defaultSort: "-spent",
  });
  const [{ rows, total }, summary] = await Promise.all([
    getSingleSourceRiskPage({
      ...params,
      level: params.facets.level,
    }),
    getSingleSourceSummary(),
  ]);

  // Fetch 69-B blacklist status for all supplier company IDs in the result set
  const supplierCompanyIds = rows
    .map((r) => r.top_supplier_company_id)
    .filter((id): id is number => id != null);
  const blacklistMap = await getSuppliersBlacklistMap(supplierCompanyIds);
  const visibleKeys = parseVisibleKeys(searchParams, "ss_");
  const sortHref = makeSortHref({
    pathname: "/compras",
    searchParams,
    paramPrefix: "ss_",
  });
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin riesgo de single source"
        description="Todos los productos tienen múltiples proveedores."
        compact
      />
    );
  }
  const view = parseViewParam(searchParams, "ss_view");
  const summaryTotalSpent = summary.reduce(
    (s, r) => s + (r.spent_12m ?? 0),
    0
  );
  const summaryChartRows = summary.map((r) => ({
    ...r,
    level_label:
      r.level === "single_source"
        ? "Único proveedor"
        : r.level === "very_high"
          ? "Muy alta"
          : "Alta",
  }));
  const summaryDonut: DataViewChartSpec = {
    type: "donut",
    xKey: "level_label",
    series: [{ dataKey: "spent_12m", label: "Gasto 12m" }],
    valueFormat: "currency-compact",
    donutCenterLabel: formatCurrencyMXN(summaryTotalSpent, { compact: true }),
    colorBy: "level",
    colorMap: {
      single_source: "var(--destructive)",
      very_high: "var(--chart-4)",
      high: "var(--chart-3)",
    },
    height: 220,
  };
  const chart: DataViewChartSpec = {
    type: "scatter",
    xKey: "total_spent_12m",
    yKey: "top_supplier_share_pct",
    series: [
      { dataKey: "total_spent_12m", label: "Gasto 12m" },
      { dataKey: "top_supplier_share_pct", label: "% concentración" },
    ],
    valueFormat: "currency-compact",
    secondaryValueFormat: "percent",
    colorBy: "concentration_level",
    colorMap: {
      single_source: "var(--destructive)",
      very_high: "var(--chart-4)",
      high: "var(--chart-3)",
    },
    referenceLine: {
      value: 90,
      axis: "y",
      label: "90% crítico",
    },
  };
  return (
    <>
      {summaryChartRows.length > 1 ? (
        <Card>
          <CardContent className="p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Concentración total · gasto 12m por nivel
            </div>
            <DataViewChart
              data={summaryChartRows as unknown as Record<string, unknown>[]}
              chart={summaryDonut}
            />
          </CardContent>
        </Card>
      ) : null}
      <DataView
        data={rows}
        columns={singleSourceColumnsBase.map((col) =>
          col.key !== "supplier"
            ? col
            : {
                ...col,
                cell: (r: SingleSourceRow) => (
                  <span className="flex flex-wrap items-center gap-1">
                    {r.top_supplier_company_id && r.top_supplier_name ? (
                      <CompanyLink
                        companyId={r.top_supplier_company_id}
                        name={r.top_supplier_name}
                        truncate
                      />
                    ) : (
                      <span className="truncate">{r.top_supplier_name ?? "—"}</span>
                    )}
                    {r.top_supplier_company_id != null &&
                      blacklistMap[r.top_supplier_company_id] && (
                        <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100 ml-1 shrink-0">
                          69-B: {blacklistMap[r.top_supplier_company_id]}
                        </Badge>
                      )}
                  </span>
                ),
              }
        )}
        chart={chart}
        view={view}
        viewHref={(next) =>
          buildComprasHref(searchParams, {
            ss_view: next === "chart" ? "chart" : null,
          })
        }
        rowKey={(r) => String(r.odoo_product_id)}
        sort={
          params.sort
            ? { key: params.sort, dir: params.sortDir }
            : null
        }
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={r.product_name ?? r.product_ref ?? "—"}
            subtitle={r.product_ref ?? undefined}
            badge={
              <Badge
                variant={
                  concentrationVariant[r.concentration_level] ?? "warning"
                }
              >
                {concentrationLabel[r.concentration_level] ??
                  r.concentration_level}
              </Badge>
            }
            fields={[
              {
                label: "Proveedor",
                value: (
                  <span className="flex flex-wrap items-center gap-1">
                    {r.top_supplier_company_id && r.top_supplier_name ? (
                      <CompanyLink
                        companyId={r.top_supplier_company_id}
                        name={r.top_supplier_name}
                        truncate
                      />
                    ) : (
                      (r.top_supplier_name ?? "—")
                    )}
                    {r.top_supplier_company_id != null &&
                      blacklistMap[r.top_supplier_company_id] && (
                        <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100">
                          69-B: {blacklistMap[r.top_supplier_company_id]}
                        </Badge>
                      )}
                  </span>
                ),
                className: "col-span-2",
              },
              {
                label: "Spent 12m",
                value: <Currency amount={r.total_spent_12m} compact />,
              },
              {
                label: "Share",
                value: `${Math.round(r.top_supplier_share_pct)}%`,
              },
            ]}
          />
        )}
      />
      {view === "table" && (
        <DataTablePagination
          paramPrefix="ss_"
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
// Price anomalies
// ──────────────────────────────────────────────────────────────────────────
const priceVariant: Record<string, "critical" | "info"> = {
  price_above_avg: "critical",
  price_below_avg: "info",
};
const priceLabel: Record<string, string> = {
  price_above_avg: "Sobre",
  price_below_avg: "Bajo",
};

const priceAnomalyViewColumns = [
  { key: "ref", label: "Ref", alwaysVisible: true },
  { key: "name", label: "Producto", defaultHidden: true },
  { key: "supplier", label: "Proveedor" },
  { key: "flag", label: "Flag" },
  { key: "vs_avg", label: "vs promedio" },
  { key: "change", label: "Cambio %" },
  { key: "last_price", label: "Último precio" },
  { key: "avg_price", label: "Precio promedio", defaultHidden: true },
  { key: "spent", label: "Total gastado" },
  { key: "date", label: "Última compra" },
];

const priceColumns: DataTableColumn<PriceAnomalyRow>[] = [
  {
    key: "ref",
    header: "Ref",
    alwaysVisible: true,
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
  },
  {
    key: "name",
    header: "Producto",
    defaultHidden: true,
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) => (
      <span className="truncate text-xs">{r.last_supplier ?? "—"}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "flag",
    header: "Flag",
    cell: (r) => (
      <Badge variant={priceVariant[r.price_flag] ?? "info"}>
        {priceLabel[r.price_flag] ?? r.price_flag}
      </Badge>
    ),
  },
  {
    key: "vs_avg",
    header: "vs prom",
    sortable: true,
    cell: (r) =>
      r.price_vs_avg_pct != null ? (
        <span
          className={`tabular-nums ${
            r.price_vs_avg_pct > 0
              ? "text-danger font-semibold"
              : "text-info"
          }`}
        >
          {r.price_vs_avg_pct > 0 ? "+" : ""}
          {r.price_vs_avg_pct.toFixed(1)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "change",
    header: "Cambio",
    sortable: true,
    cell: (r) =>
      r.price_change_pct != null ? (
        <span className="tabular-nums">
          {r.price_change_pct > 0 ? "+" : ""}
          {r.price_change_pct.toFixed(1)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "last_price",
    header: "Último",
    sortable: true,
    cell: (r) =>
      r.last_price != null ? (
        <span className="tabular-nums">
          {r.last_price.toLocaleString("es-MX", { maximumFractionDigits: 2 })}{" "}
          <span className="text-[10px] text-muted-foreground">
            {r.currency ?? ""}
          </span>
        </span>
      ) : (
        "—"
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "avg_price",
    header: "Promedio",
    defaultHidden: true,
    cell: (r) =>
      r.avg_price != null ? (
        <span className="tabular-nums">
          {r.avg_price.toLocaleString("es-MX", { maximumFractionDigits: 2 })}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "spent",
    header: "Total",
    sortable: true,
    cell: (r) => <Currency amount={r.total_spent} compact />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_spent ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "date",
    header: "Última",
    sortable: true,
    cell: (r) => <DateDisplay date={r.last_purchase_date} relative />,
    hideOnMobile: true,
  },
];

async function PriceAnomaliesTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "pa_",
    facetKeys: ["flag"],
    defaultSize: 25,
    defaultSort: "-spent",
  });

  // Aplicar pa_period si no hay rango manual (pa_from / pa_to tiene precedencia).
  // Columna de fecha en purchase_price_intelligence: last_purchase_date.
  const paPeriod = parsePeriod(searchParams.pa_period);
  const useManualRange = params.from || params.to;
  const effectiveFrom =
    params.from ??
    (useManualRange || (paPeriod.kind === "preset" && paPeriod.preset === "all")
      ? undefined
      : periodBoundsIso(paPeriod).from);
  const effectiveTo =
    params.to ??
    (useManualRange || (paPeriod.kind === "preset" && paPeriod.preset === "all")
      ? undefined
      : periodBoundsIso(paPeriod).to);

  const { rows, total } = await getPriceAnomaliesPage({
    ...params,
    from: effectiveFrom,
    to: effectiveTo,
    flag: params.facets.flag,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "pa_");
  const sortHref = makeSortHref({
    pathname: "/compras",
    searchParams,
    paramPrefix: "pa_",
  });
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin anomalías de precio"
        description="Todos los precios están dentro del rango normal."
        compact
      />
    );
  }
  const view = parseViewParam(searchParams, "pa_view");
  const chart: DataViewChartSpec = {
    type: "composed",
    xKey: "product_ref",
    topN: 15,
    series: [
      {
        dataKey: "price_vs_avg_pct",
        label: "% vs promedio",
        kind: "bar",
        yAxisId: "left",
      },
      {
        dataKey: "price_change_pct",
        label: "Δ MoM %",
        kind: "line",
        yAxisId: "right",
        color: "var(--chart-5)",
      },
    ],
    valueFormat: "percent",
    secondaryValueFormat: "percent",
    colorBy: "price_flag",
    colorMap: {
      price_above_avg: "var(--destructive)",
      price_below_avg: "var(--chart-2)",
    },
    referenceLine: {
      value: 0,
      axis: "y",
    },
  };
  return (
    <>
      <DataView
        data={rows}
        columns={priceColumns}
        chart={chart}
        view={view}
        viewHref={(next) =>
          buildComprasHref(searchParams, {
            pa_view: next === "chart" ? "chart" : null,
          })
        }
        rowKey={(r, i) => `${r.product_ref ?? "p"}-${i}`}
        sort={
          params.sort ? { key: params.sort, dir: params.sortDir } : null
        }
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={r.product_name ?? r.product_ref ?? "—"}
            subtitle={r.last_supplier ?? undefined}
            badge={
              <Badge variant={priceVariant[r.price_flag] ?? "info"}>
                {priceLabel[r.price_flag] ?? r.price_flag}
              </Badge>
            }
            fields={[
              {
                label: "vs prom",
                value:
                  r.price_vs_avg_pct != null
                    ? `${r.price_vs_avg_pct > 0 ? "+" : ""}${r.price_vs_avg_pct.toFixed(1)}%`
                    : "—",
                className:
                  r.price_vs_avg_pct != null && r.price_vs_avg_pct > 0
                    ? "text-danger font-semibold"
                    : "text-info",
              },
              {
                label: "Total",
                value: <Currency amount={r.total_spent} compact />,
              },
              {
                label: "Último precio",
                value:
                  r.last_price != null
                    ? `${r.last_price.toLocaleString("es-MX")} ${r.currency ?? ""}`
                    : "—",
              },
              {
                label: "Última compra",
                value: <DateDisplay date={r.last_purchase_date} relative />,
              },
            ]}
          />
        )}
      />
      {view === "table" && (
        <DataTablePagination
          paramPrefix="pa_"
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
// Top suppliers
// ──────────────────────────────────────────────────────────────────────────
const topSupplierViewColumns = [
  { key: "name", label: "Proveedor", alwaysVisible: true },
  { key: "spent", label: "Total gastado" },
  { key: "products", label: "# productos" },
  { key: "orders", label: "# órdenes" },
];

const supplierColumns: DataTableColumn<TopSupplierRow>[] = [
  {
    key: "name",
    header: "Proveedor",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <span className="font-semibold truncate">{r.supplier_name}</span>
    ),
  },
  {
    key: "spent",
    header: "Total",
    sortable: true,
    cell: (r) => <Currency amount={r.total_spent} compact />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_spent ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "products",
    header: "Productos",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{r.product_count}</span>
    ),
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <span className="tabular-nums">
        {rows.reduce((s, r) => s + (r.product_count ?? 0), 0)}
      </span>
    ),
  },
  {
    key: "orders",
    header: "Órdenes",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{r.order_count}</span>
    ),
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <span className="tabular-nums">
        {rows.reduce((s, r) => s + (r.order_count ?? 0), 0)}
      </span>
    ),
  },
];

async function TopSuppliersTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "sup_",
    defaultSize: 25,
    defaultSort: "-spent",
  });
  const { rows, total } = await getTopSuppliersPage(params);
  const visibleKeys = parseVisibleKeys(searchParams, "sup_");
  const sortHref = makeSortHref({
    pathname: "/compras",
    searchParams,
    paramPrefix: "sup_",
  });
  const view = parseViewParam(searchParams, "sup_view");
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "supplier_name",
    topN: 15,
    series: [
      {
        dataKey: "total_spent",
        label: "Total gastado",
        color: "var(--chart-2)",
      },
    ],
    valueFormat: "currency-compact",
  };
  return (
    <>
    <DataView
      data={rows}
      columns={supplierColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildComprasHref(searchParams, {
          sup_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => r.supplier_name}
      sort={
        params.sort ? { key: params.sort, dir: params.sortDir } : null
      }
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={r.supplier_name}
          fields={[
            {
              label: "Total",
              value: <Currency amount={r.total_spent} compact />,
            },
            { label: "Productos", value: r.product_count },
            { label: "Órdenes", value: r.order_count },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin proveedores",
        description: "No hay datos en supplier_product_matrix.",
      }}
    />
    {view === "table" && (
      <DataTablePagination
        paramPrefix="sup_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="proveedores"
      />
    )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Recent purchases (kept)
// ──────────────────────────────────────────────────────────────────────────
const purchaseOrderViewColumns = [
  { key: "name", label: "Orden", alwaysVisible: true },
  { key: "company", label: "Proveedor" },
  { key: "buyer", label: "Comprador" },
  { key: "amount", label: "Monto" },
  { key: "date", label: "Fecha" },
  { key: "state", label: "Estado" },
];

const orderColumns: DataTableColumn<RecentPurchaseOrder>[] = [
  {
    key: "name",
    header: "Orden",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "company",
    header: "Proveedor",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
      ) : (
        (r.company_name ?? "—")
      ),
  },
  {
    key: "buyer",
    header: "Comprador",
    cell: (r) => r.buyer_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "amount",
    header: "Monto",
    sortable: true,
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.amount_total_mxn ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "date",
    header: "Fecha",
    sortable: true,
    cell: (r) => <DateDisplay date={r.date_order} relative />,
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    sortable: true,
    cell: (r) => <StatusBadge status={(r.state ?? "draft") as "draft"} />,
  },
];

async function PurchaseOrdersToolbar() {
  const buyers = await getPurchaseBuyerOptions();
  return (
    <DataTableToolbar
      paramPrefix="po_"
      searchPlaceholder="Buscar OC…"
      dateRange={{ label: "Fecha OC" }}
      facets={[
        {
          key: "state",
          label: "Estado",
          options: [
            { value: "draft", label: "Borrador" },
            { value: "sent", label: "Solicitado" },
            { value: "to approve", label: "Por aprobar" },
            { value: "purchase", label: "Confirmada" },
            { value: "done", label: "Completada" },
            { value: "cancel", label: "Cancelada" },
          ],
        },
        {
          key: "buyer",
          label: "Comprador",
          options: buyers.map((b) => ({ value: b, label: b })),
        },
      ]}
    />
  );
}

async function RecentPurchasesTable({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "po_",
    facetKeys: ["state", "buyer"],
    defaultSize: 25,
    defaultSort: "-date",
  });

  // Aplicar po_period si no hay rango manual (po_from / po_to tiene precedencia).
  // Columna de fecha en odoo_purchase_orders: date_order.
  const poPeriod = parsePeriod(searchParams.po_period);
  const useManualRange = params.from || params.to;
  const effectiveFrom =
    params.from ??
    (useManualRange || (poPeriod.kind === "preset" && poPeriod.preset === "all")
      ? undefined
      : periodBoundsIso(poPeriod).from);
  const effectiveTo =
    params.to ??
    (useManualRange || (poPeriod.kind === "preset" && poPeriod.preset === "all")
      ? undefined
      : periodBoundsIso(poPeriod).to);

  const { rows, total } = await getPurchaseOrdersPage({
    ...params,
    from: effectiveFrom,
    to: effectiveTo,
    state: params.facets.state,
    buyer: params.facets.buyer,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "po_");
  const sortHref = makeSortHref({
    pathname: "/compras",
    searchParams,
    paramPrefix: "po_",
  });
  const view = parseViewParam(searchParams, "po_view");
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "name",
    topN: 15,
    series: [
      {
        dataKey: "amount_total_mxn",
        label: "Monto",
        color: "var(--chart-3)",
      },
    ],
    valueFormat: "currency-compact",
  };
  return (
    <>
      <DataView
        data={rows}
        columns={orderColumns}
        chart={chart}
        view={view}
        viewHref={(next) =>
          buildComprasHref(searchParams, {
            po_view: next === "chart" ? "chart" : null,
          })
        }
        rowKey={(r) => String(r.id)}
        sort={
          params.sort ? { key: params.sort, dir: params.sortDir } : null
        }
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={
              r.company_id ? (
                <CompanyLink
                  companyId={r.company_id}
                  name={r.company_name}
                  truncate
                />
              ) : (
                (r.company_name ?? "—")
              )
            }
            subtitle={r.name ?? undefined}
            badge={<StatusBadge status={(r.state ?? "draft") as "draft"} />}
            fields={[
              {
                label: "Monto",
                value: <Currency amount={r.amount_total_mxn} />,
              },
              {
                label: "Fecha",
                value: <DateDisplay date={r.date_order} relative />,
              },
              {
                label: "Comprador",
                value: r.buyer_name ?? "—",
                className: "col-span-2",
              },
            ]}
          />
        )}
        emptyState={{
          icon: ShoppingBag,
          title: "Sin órdenes",
          description: "Ajusta los filtros o el rango de fechas.",
        }}
      />
      {view === "table" && (
        <DataTablePagination
          paramPrefix="po_"
          total={total}
          page={params.page}
          pageSize={params.size}
          unit="órdenes"
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Cola de reposición (era /compras/stockouts)
// ──────────────────────────────────────────────────────────────────────────
const urgencyVariant: Record<
  StockoutUrgency,
  "danger" | "warning" | "info" | "secondary"
> = {
  STOCKOUT: "danger",
  CRITICAL: "danger",
  URGENT: "warning",
  ATTENTION: "info",
  OK: "secondary",
};

const urgencyLabel: Record<StockoutUrgency, string> = {
  STOCKOUT: "Sin stock",
  CRITICAL: "Crítico",
  URGENT: "Urgente",
  ATTENTION: "Atención",
  OK: "OK",
};

const stockoutColumns: DataTableColumn<StockoutRow>[] = [
  {
    key: "urgency",
    header: "Urgencia",
    alwaysVisible: true,
    cell: (r) => (
      <Badge variant={urgencyVariant[r.urgency]} className="text-[10px] uppercase">
        {urgencyLabel[r.urgency]}
      </Badge>
    ),
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold">
          {r.product_ref ?? "—"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {r.product_name ?? ""}
        </div>
      </div>
    ),
  },
  {
    key: "stock",
    header: "Disponible",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.available_qty)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "days_stock",
    header: "Días stock",
    sortable: true,
    cell: (r) => (
      <span
        className={`tabular-nums ${
          r.days_of_stock != null && r.days_of_stock <= 7
            ? "font-bold text-danger"
            : r.days_of_stock != null && r.days_of_stock <= 15
              ? "text-warning"
              : ""
        }`}
      >
        {r.days_of_stock != null ? Math.round(r.days_of_stock) : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "suggested",
    header: "Orden sugerida",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        {Math.round(r.suggested_order_qty)}
      </span>
    ),
    align: "right",
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) =>
      r.last_supplier_id && r.last_supplier_name ? (
        <CompanyLink
          companyId={r.last_supplier_id}
          name={r.last_supplier_name}
          truncate
        />
      ) : (
        <span className="truncate text-xs text-muted-foreground">
          {r.last_supplier_name ?? "—"}
        </span>
      ),
  },
  {
    key: "cost",
    header: "Costo reposición",
    sortable: true,
    cell: (r) => <Currency amount={r.replenish_cost_mxn} compact />,
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.replenish_cost_mxn ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "risk",
    header: "Revenue en riesgo 30d",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        <Currency amount={r.revenue_at_risk_30d_mxn} compact />
      </span>
    ),
    align: "right",
    summary: (rows) => (
      <span className="font-bold text-danger">
        <Currency
          amount={rows.reduce(
            (s, r) => s + (r.revenue_at_risk_30d_mxn ?? 0),
            0
          )}
          compact
        />
      </span>
    ),
  },
];

async function StockoutsSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rows = await getStockoutQueue(undefined, 50);
  const actionable = rows.filter(
    (r) => r.urgency !== "OK" && r.urgency !== "ATTENTION"
  );
  if (actionable.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Sin productos urgentes"
        description="Todo el inventario está en buen nivel."
        compact
      />
    );
  }
  const view = parseViewParam(searchParams, "so_view");
  const chart: DataViewChartSpec = {
    type: "scatter",
    xKey: "days_of_stock",
    yKey: "revenue_at_risk_30d_mxn",
    sizeKey: "suggested_order_qty",
    series: [
      { dataKey: "days_of_stock", label: "Días de stock" },
      { dataKey: "revenue_at_risk_30d_mxn", label: "Revenue en riesgo" },
    ],
    valueFormat: "number",
    secondaryValueFormat: "currency-compact",
    colorBy: "urgency",
    colorMap: {
      STOCKOUT: "var(--destructive)",
      CRITICAL: "var(--chart-4)",
      URGENT: "var(--chart-3)",
      ATTENTION: "var(--chart-2)",
      OK: "var(--chart-1)",
    },
    referenceLine: {
      value: 7,
      axis: "x",
      label: "7d crítico",
    },
  };
  return (
    <DataView
      data={actionable}
      columns={stockoutColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildComprasHref(searchParams, {
          so_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.odoo_product_id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          badge={
            <Badge variant={urgencyVariant[r.urgency]}>
              {urgencyLabel[r.urgency]}
            </Badge>
          }
          fields={[
            {
              label: "Días stock",
              value: r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
            },
            {
              label: "Orden sugerida",
              value: Math.round(r.suggested_order_qty),
            },
            {
              label: "Proveedor",
              value: r.last_supplier_name ?? "—",
              className: "col-span-2 truncate",
            },
            {
              label: "Revenue en riesgo",
              value: <Currency amount={r.revenue_at_risk_30d_mxn} compact />,
              className: "col-span-2 text-danger font-semibold",
            },
          ]}
        />
      )}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Variancia vs mercado (era /compras/price-variance)
// ──────────────────────────────────────────────────────────────────────────
const priceFlagVariant: Record<
  PriceFlag,
  "danger" | "warning" | "info" | "success" | "secondary"
> = {
  overpriced: "danger",
  above_market: "warning",
  aligned: "info",
  below_market: "success",
  single_source: "secondary",
};

const priceFlagLabel: Record<PriceFlag, string> = {
  overpriced: "Sobreprecio",
  above_market: "Encima",
  aligned: "Alineado",
  below_market: "Debajo",
  single_source: "Único",
};

function formatMonthShort(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", {
    month: "short",
    year: "2-digit",
  });
}

const varianceColumns: DataTableColumn<SupplierPriceRow>[] = [
  {
    key: "month",
    header: "Mes",
    cell: (r) => (
      <span className="font-mono text-[10px] uppercase tabular-nums text-muted-foreground">
        {formatMonthShort(r.month)}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold">
          {r.product_ref ?? "—"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {r.product_name ?? ""}
        </div>
      </div>
    ),
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) => (
      <span className="truncate text-xs">{r.supplier_name}</span>
    ),
  },
  {
    key: "flag",
    header: "Flag",
    cell: (r) => (
      <Badge
        variant={priceFlagVariant[r.price_flag]}
        className="text-[10px] uppercase"
      >
        {priceFlagLabel[r.price_flag]}
      </Badge>
    ),
  },
  {
    key: "delta",
    header: "vs benchmark",
    sortable: true,
    cell: (r) => (
      <span
        className={`font-semibold tabular-nums ${
          r.price_delta > 0 ? "text-danger" : "text-success"
        }`}
      >
        {r.price_delta > 0 ? "+" : ""}
        {r.price_delta.toFixed(0)}%
      </span>
    ),
    align: "right",
  },
  {
    key: "price",
    header: "Precio",
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.supplier_avg_price.toLocaleString("es-MX", {
          maximumFractionDigits: 2,
        })}
      </span>
    ),
    align: "right",
  },
  {
    key: "overpaid",
    header: "Sobreprecio",
    sortable: true,
    cell: (r) =>
      r.overpaid_mxn > 0 ? (
        <span className="font-semibold text-danger tabular-nums">
          <Currency amount={r.overpaid_mxn} compact />
        </span>
      ) : r.saved_mxn > 0 ? (
        <span className="text-success tabular-nums">
          −<Currency amount={r.saved_mxn} compact />
        </span>
      ) : (
        "—"
      ),
    align: "right",
    summary: (rows) => {
      const overpaid = rows.reduce(
        (s, r) => s + (Number(r.overpaid_mxn) || 0),
        0
      );
      const saved = rows.reduce(
        (s, r) => s + (Number(r.saved_mxn) || 0),
        0
      );
      const net = overpaid - saved;
      if (net === 0) return <span className="text-muted-foreground">—</span>;
      return net > 0 ? (
        <span className="font-bold text-danger">
          <Currency amount={net} compact />
        </span>
      ) : (
        <span className="font-bold text-success">
          −<Currency amount={Math.abs(net)} compact />
        </span>
      );
    },
  },
];

async function VarianceMarketSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Combinamos overpriced + above_market + below_market en una tabla.
  const [overpriced, aboveMarket, belowMarket] = await Promise.all([
    getSupplierPriceAlerts("overpriced", 6, 60),
    getSupplierPriceAlerts("above_market", 6, 40),
    getSupplierPriceAlerts("below_market", 6, 20),
  ]);
  const all = [...overpriced, ...aboveMarket, ...belowMarket].sort(
    (a, b) => b.overpaid_mxn + b.saved_mxn - (a.overpaid_mxn + a.saved_mxn)
  );
  if (all.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Sin variancia detectable"
        description="Todos los precios están alineados con el mercado."
        compact
      />
    );
  }
  const view = parseViewParam(searchParams, "vm_view");
  // Enrich rows with a display-friendly label for the x-axis.
  const chartRows = all.map((r) => ({
    ...r,
    label: `${r.product_ref ?? "?"} · ${r.supplier_name}`,
  }));
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "label",
    topN: 15,
    layout: "horizontal",
    series: [
      {
        dataKey: "overpaid_mxn",
        label: "Sobreprecio MXN",
      },
    ],
    valueFormat: "currency-compact",
    colorBy: "price_flag",
    colorMap: {
      single_source: "var(--chart-5)",
      overpriced: "var(--destructive)",
      above_market: "var(--chart-4)",
      aligned: "var(--chart-3)",
      below_market: "var(--chart-2)",
    },
    height: 480,
  };
  return (
    <DataView
      data={chartRows}
      columns={varianceColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildComprasHref(searchParams, {
          vm_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r, i) => `${r.odoo_product_id}-${r.supplier_id}-${r.month}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={`${r.supplier_name} · ${formatMonthShort(r.month)}`}
          badge={
            <Badge variant={priceFlagVariant[r.price_flag]}>
              {priceFlagLabel[r.price_flag]}
            </Badge>
          }
          fields={[
            {
              label: "vs benchmark",
              value: `${r.price_delta > 0 ? "+" : ""}${r.price_delta.toFixed(0)}%`,
              className:
                r.price_delta > 0
                  ? "text-danger font-semibold"
                  : "text-success",
            },
            {
              label: r.overpaid_mxn > 0 ? "Sobreprecio" : "Ahorro",
              value: (
                <Currency
                  amount={r.overpaid_mxn > 0 ? r.overpaid_mxn : r.saved_mxn}
                  compact
                />
              ),
            },
          ]}
        />
      )}
    />
  );
}
