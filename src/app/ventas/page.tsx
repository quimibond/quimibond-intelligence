import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ShoppingCart,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  DataView,
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
  TrendIndicator,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  getSalesKpis,
  getSalesRevenueTrend,
  getReorderRiskPage,
  getTopCustomersPage,
  getTopSalespeople,
  getSaleOrdersPage,
  getSaleOrdersTimeline,
  getSaleOrderSalespeopleOptions,
  type ReorderRiskRow,
  type TopCustomerRow,
  type SalespersonRow,
  type RecentSaleOrder,
} from "@/lib/queries/sales";
import {
  getCustomerCohorts,
  type CohortMatrix,
} from "@/lib/queries/analytics";
import { getPlHistory } from "@/lib/queries/finance";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import { formatCurrencyMXN } from "@/lib/formatters";

import { SalesTrendChart } from "./_components/sales-trend-chart";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";

export const revalidate = 60; // 60s ISR cache · data freshness OK (pg_cron 15min)
export const metadata = { title: "Ventas" };

type SearchParams = Record<string, string | string[] | undefined>;

function buildVentasHref(
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
  return s ? `/ventas?${s}` : "/ventas";
}

function parseViewParam(sp: SearchParams, key: string): DataViewMode {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "chart" ? "chart" : "table";
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Ventas"
        subtitle="¿Cómo van las ventas, quién compra y quién dejó de comprar?"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source="odoo" coverage="2021+" />
            <a
              href="/ventas/cohorts"
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Retención por cohorte →
            </a>
          </div>
        }
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "trend", label: "Tendencia 12m" },
          { id: "retention", label: "Retención" },
          { id: "reorder", label: "Reorder risk" },
          { id: "top-customers", label: "Top clientes" },
          { id: "salespeople", label: "Vendedores" },
          { id: "orders", label: "Pedidos" },
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
        <SalesKpisSection />
      </Suspense>
      </section>

      <section id="trend" className="scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-md" />}
          >
            <RevenueChartSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="retention" className="scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retención por cohorte</CardTitle>
          <p className="text-xs text-muted-foreground">
            % de clientes de cada cohort trimestral que siguen activos N
            trimestres después de su primera compra. Filas = trimestre de
            adquisición. Columnas = trimestres desde primera compra.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            }
          >
            <CohortHeatmapSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="reorder" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Reorder risk — clientes que deberían haber comprado
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Filtra por estado de reorden y tier para priorizar a quién
              llamar.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="rr_"
              columns={reorderRiskViewColumns}
            />
            <TableExportButton filename="reorder-risk" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="rr_"
            searchPlaceholder="Buscar cliente…"
            facets={[
              {
                key: "status",
                label: "Estado",
                options: [
                  { value: "critical", label: "Crítico" },
                  { value: "overdue", label: "Vencido" },
                  { value: "at_risk", label: "En riesgo" },
                ],
              },
              {
                key: "tier",
                label: "Tier",
                options: [
                  { value: "A", label: "Tier A" },
                  { value: "B", label: "Tier B" },
                  { value: "C", label: "Tier C" },
                ],
              },
            ]}
          />
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <ReorderRiskTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="top-customers" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Top clientes (revenue 90d)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ordena por revenue, margen o lifetime. Busca por nombre.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="tc_"
              columns={topCustomerViewColumns}
            />
            <TableExportButton filename="top-customers" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="tc_"
            searchPlaceholder="Buscar cliente…"
          />
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <TopCustomersTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="salespeople" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Ranking de vendedores este mes
            </CardTitle>
          </div>
          <TableExportButton filename="salespeople" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[200px] rounded-xl" />}>
            <SalespeopleTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="orders" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Pedidos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Busca por número o filtra por vendedor, estado y fecha. Datos en
              vivo de Odoo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="so_"
              columns={saleOrderViewColumns}
            />
            <TableExportButton filename="sale-orders" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={null}>
            <SaleOrdersToolbar />
          </Suspense>
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <RecentOrdersTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
async function SalesKpisSection() {
  const [k, trend, pl] = await Promise.all([
    getSalesKpis(),
    getSalesRevenueTrend(12),
    getPlHistory(12),
  ]);
  const revenueSpark = trend.map((p) => ({ value: p.revenue }));
  // getPlHistory retorna desc → invertir para sparkline presente al final.
  const plOrdered = [...pl].reverse();
  const utilidadSpark = plOrdered.map((p) => ({
    value: p.utilidadOperativa,
  }));
  const yoySpark = trend.map((p) => ({ value: p.revenue }));
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Ingresos del mes"
        value={k.ingresosMes}
        format="currency"
        compact
        icon={TrendingUp}
        trend={{ value: k.ingresosMomPct, good: "up" }}
        subtitle="vs mes anterior"
        tone={k.ingresosMomPct >= 0 ? "success" : "warning"}
        sparkline={{ data: revenueSpark, variant: "area" }}
      />
      <KpiCard
        title="Utilidad operativa"
        value={k.utilidadOperativaMes}
        format="currency"
        compact
        icon={k.utilidadOperativaMes >= 0 ? ArrowUpRight : ArrowDownRight}
        subtitle="del mes"
        tone={k.utilidadOperativaMes >= 0 ? "success" : "danger"}
        sparkline={
          utilidadSpark.length > 1
            ? { data: utilidadSpark, variant: "area" }
            : undefined
        }
      />
      <KpiCard
        title="YoY"
        value={k.ingresosYoyPct}
        format="percent"
        icon={TrendingUp}
        subtitle={`vs ${formatCurrencyMXN(k.ingresosYoy, { compact: true })} año pasado`}
        tone={k.ingresosYoyPct >= 0 ? "success" : "danger"}
        sparkline={
          yoySpark.length > 1
            ? { data: yoySpark, variant: "line" }
            : undefined
        }
      />
      <KpiCard
        title="Pedidos del mes"
        value={k.pedidosMes}
        format="number"
        icon={ShoppingCart}
        subtitle={`Ticket ${formatCurrencyMXN(k.ticketPromedio, { compact: true })}`}
      />
    </StatGrid>
  );
}

async function RevenueChartSection() {
  const data = await getSalesRevenueTrend(12);
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos de ingresos"
        description="No hay datos en monthly_revenue_by_company."
        compact
      />
    );
  }
  return <SalesTrendChart data={data} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder risk
// ──────────────────────────────────────────────────────────────────────────
const reorderStatusVariant: Record<
  string,
  "warning" | "critical" | "info"
> = {
  overdue: "warning",
  at_risk: "warning",
  critical: "critical",
};
const reorderStatusLabel: Record<string, string> = {
  overdue: "Vencido",
  at_risk: "En riesgo",
  critical: "Crítico",
};

const reorderRiskViewColumns = [
  { key: "company", label: "Cliente", alwaysVisible: true },
  { key: "status", label: "Estado" },
  { key: "days_overdue", label: "Días vencido" },
  { key: "avg_cycle", label: "Ciclo promedio", defaultHidden: true },
  { key: "days_since", label: "Días desde última", defaultHidden: true },
  { key: "total_revenue", label: "Revenue total" },
  { key: "avg_order", label: "Ticket promedio", defaultHidden: true },
  { key: "top_product", label: "Top producto", defaultHidden: true },
  { key: "salesperson", label: "Vendedor" },
];

const reorderColumns: DataTableColumn<ReorderRiskRow>[] = [
  {
    key: "company",
    header: "Cliente",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name}
        tier={(r.tier as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={reorderStatusVariant[r.status] ?? "warning"}>
        {reorderStatusLabel[r.status] ?? r.status}
      </Badge>
    ),
  },
  {
    key: "days_overdue",
    header: "Días vencido",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold tabular-nums text-warning-foreground">
        {r.days_overdue_reorder ? Math.round(r.days_overdue_reorder) : "—"}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "avg_cycle",
    header: "Ciclo prom.",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.avg_cycle_days ? `${Math.round(r.avg_cycle_days)}d` : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "days_since",
    header: "Días desde",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.days_since_last ? `${Math.round(r.days_since_last)}d` : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "total_revenue",
    header: "Revenue total",
    sortable: true,
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "avg_order",
    header: "Ticket prom.",
    defaultHidden: true,
    cell: (r) => <Currency amount={r.avg_order_value} compact />,
    align: "right",
  },
  {
    key: "top_product",
    header: "Top producto",
    defaultHidden: true,
    cell: (r) => (
      <span className="font-mono text-[11px]">
        {r.top_product_ref ?? "—"}
      </span>
    ),
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
];

async function ReorderRiskTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "rr_",
    facetKeys: ["status", "tier"],
    defaultSize: 25,
    defaultSort: "-total_revenue",
  });
  const { rows, total } = await getReorderRiskPage({
    ...params,
    status: params.facets.status,
    tier: params.facets.tier,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "rr_");
  const sortHref = makeSortHref({
    pathname: "/ventas",
    searchParams,
    paramPrefix: "rr_",
  });
  const view = parseViewParam(searchParams, "rr_view");
  const chart: DataViewChartSpec = {
    type: "scatter",
    xKey: "days_overdue_reorder",
    yKey: "total_revenue",
    sizeKey: "avg_order_value",
    series: [
      { dataKey: "days_overdue_reorder", label: "Días vencido" },
      { dataKey: "total_revenue", label: "Revenue total" },
    ],
    valueFormat: "number",
    secondaryValueFormat: "currency-compact",
    colorBy: "status",
    colorMap: {
      critical: "var(--destructive)",
      overdue: "var(--chart-4)",
      at_risk: "var(--chart-3)",
    },
    referenceLine: {
      value: 0,
      axis: "x",
      label: "A tiempo",
    },
    rowHrefTemplate: "/empresas/{company_id}",
  };
  return (
    <div className="space-y-3">
    <DataView
      data={rows}
      columns={reorderColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildVentasHref(searchParams, {
          rr_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.company_id)}
      rowHref={(r) => `/companies/${r.company_id}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              tier={(r.tier as "A" | "B" | "C") ?? undefined}
              truncate
            />
          }
          subtitle={r.salesperson_name ?? undefined}
          badge={
            <Badge variant={reorderStatusVariant[r.status] ?? "warning"}>
              {reorderStatusLabel[r.status] ?? r.status}
            </Badge>
          }
          fields={[
            {
              label: "Días vencido",
              value: r.days_overdue_reorder
                ? Math.round(r.days_overdue_reorder)
                : "—",
            },
            {
              label: "Revenue total",
              value: <Currency amount={r.total_revenue} compact />,
            },
            {
              label: "Ciclo prom.",
              value: r.avg_cycle_days
                ? `${Math.round(r.avg_cycle_days)}d`
                : "—",
            },
            {
              label: "Top producto",
              value: r.top_product_ref ?? "—",
            },
          ]}
        />
      )}
      emptyState={{
        icon: AlertTriangle,
        title: "Sin reorder risk",
        description: "Todos los clientes están comprando a tiempo.",
      }}
    />
    <DataTablePagination
      paramPrefix="rr_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="clientes"
    />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top customers
// ──────────────────────────────────────────────────────────────────────────
const topCustomerViewColumns = [
  { key: "company", label: "Cliente", alwaysVisible: true },
  { key: "revenue_90d", label: "Revenue 90d" },
  { key: "revenue_total", label: "Revenue lifetime", defaultHidden: true },
  { key: "margin_12m", label: "Margen 12m" },
  { key: "margin_pct", label: "Margen material %" },
  { key: "adjusted_margin_pct", label: "Margen real %" },
];

const customerColumns: DataTableColumn<TopCustomerRow>[] = [
  {
    key: "company",
    header: "Cliente",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
    ),
  },
  {
    key: "revenue_90d",
    header: "Revenue 90d",
    sortable: true,
    cell: (r) => <Currency amount={r.revenue_90d} compact />,
    align: "right",
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.revenue_90d ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "revenue_total",
    header: "Revenue lifetime",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <Currency amount={r.total_revenue_lifetime} compact />,
    align: "right",
    summary: (rows) => (
      <Currency
        amount={rows.reduce(
          (s, r) => s + (r.total_revenue_lifetime ?? 0),
          0
        )}
        compact
      />
    ),
  },
  {
    key: "margin_12m",
    header: "Margen 12m",
    cell: (r) =>
      r.margin_12m != null ? <Currency amount={r.margin_12m} compact /> : "—",
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.margin_12m ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "margin_pct",
    header: "Margen material %",
    cell: (r) =>
      r.margin_pct_12m != null ? (
        <span
          className="tabular-nums text-muted-foreground"
          title="Revenue menos costo material (BOM/standard_price). NO incluye overhead, labor, merma. Usar 'Margen real' para decisiones contables."
        >
          {r.margin_pct_12m.toFixed(1)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "adjusted_margin_pct",
    header: "Margen real %",
    cell: (r) =>
      r.adjusted_margin_pct_12m != null ? (
        <span
          className={`tabular-nums font-semibold ${
            r.adjusted_margin_pct_12m < 0
              ? "text-danger"
              : r.adjusted_margin_pct_12m < 5
                ? "text-warning"
                : r.adjusted_margin_pct_12m >= 25
                  ? "text-success"
                  : "text-foreground"
          }`}
          title={
            r.adjusted_margin_pct_12m < 0
              ? `PÉRDIDA real estimada. Material ${r.margin_pct_12m?.toFixed(1)}% − overhead ${r.overhead_factor_pct.toFixed(1)}%.`
              : `Estimado = material ${r.margin_pct_12m?.toFixed(1)}% − overhead ${r.overhead_factor_pct.toFixed(1)}%. Weighted ≈ P&L real.`
          }
        >
          {r.adjusted_margin_pct_12m < 0 && "⚠ "}
          {r.adjusted_margin_pct_12m.toFixed(1)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
];

async function TopCustomersTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "tc_",
    defaultSize: 25,
    defaultSort: "-revenue_90d",
  });
  const { rows, total } = await getTopCustomersPage(params);
  const visibleKeys = parseVisibleKeys(searchParams, "tc_");
  const sortHref = makeSortHref({
    pathname: "/ventas",
    searchParams,
    paramPrefix: "tc_",
  });
  const view = parseViewParam(searchParams, "tc_view");
  const chart: DataViewChartSpec = {
    type: "composed",
    xKey: "company_name",
    topN: 15,
    series: [
      {
        dataKey: "revenue_90d",
        label: "Revenue 90d",
        kind: "bar",
        yAxisId: "left",
      },
      {
        dataKey: "margin_pct_12m",
        label: "Margen % 12m",
        kind: "line",
        yAxisId: "right",
        color: "var(--chart-4)",
      },
    ],
    valueFormat: "currency-compact",
    secondaryValueFormat: "percent",
    rowHrefTemplate: "/empresas/{company_id}",
  };
  return (
    <div className="space-y-3">
    <DataView
      data={rows}
      columns={customerColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildVentasHref(searchParams, {
          tc_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.company_id)}
      rowHref={(r) => `/companies/${r.company_id}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              truncate
            />
          }
          fields={[
            {
              label: "90d",
              value: <Currency amount={r.revenue_90d} compact />,
            },
            {
              label: "Margen %",
              value:
                r.margin_pct_12m != null
                  ? `${r.margin_pct_12m.toFixed(1)}%`
                  : "—",
            },
            {
              label: "Margen 12m",
              value:
                r.margin_12m != null ? (
                  <Currency amount={r.margin_12m} compact />
                ) : (
                  "—"
                ),
              className: "col-span-2",
            },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin clientes activos",
        description: "No hay revenue en últimos 90d.",
      }}
    />
    <DataTablePagination
      paramPrefix="tc_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="clientes"
    />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Salespeople ranking
// ──────────────────────────────────────────────────────────────────────────
interface SalespersonRanked extends SalespersonRow {
  rank: number;
}

const salespersonColumns: DataTableColumn<SalespersonRanked>[] = [
  {
    key: "rank",
    header: "#",
    alwaysVisible: true,
    cell: (r) => (
      <span className="text-muted-foreground tabular-nums">#{r.rank}</span>
    ),
  },
  {
    key: "name",
    header: "Vendedor",
    alwaysVisible: true,
    cell: (r) => <span className="font-semibold">{r.name}</span>,
  },
  {
    key: "orders",
    header: "Pedidos",
    cell: (r) => <span className="tabular-nums">{r.order_count}</span>,
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <span className="tabular-nums">
        {rows.reduce((s, r) => s + (r.order_count ?? 0), 0)}
      </span>
    ),
  },
  {
    key: "avg_ticket",
    header: "Ticket promedio",
    defaultHidden: true,
    cell: (r) => (
      <Currency
        amount={r.order_count > 0 ? r.total_amount / r.order_count : 0}
        compact
      />
    ),
    align: "right",
    summary: (rows) => {
      const totalAmt = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
      const totalOrders = rows.reduce((s, r) => s + (r.order_count ?? 0), 0);
      return (
        <Currency
          amount={totalOrders > 0 ? totalAmt / totalOrders : 0}
          compact
        />
      );
    },
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => <Currency amount={r.total_amount} compact />,
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_amount ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
];

interface SalespersonChartRow extends SalespersonRanked {
  rank_bucket: string;
}

async function SalespeopleTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rows = await getTopSalespeople();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="Sin pedidos del mes"
        description="No hay sale orders en el mes actual."
        compact
      />
    );
  }
  const ranked: SalespersonChartRow[] = rows.map((r, i) => {
    const rank = i + 1;
    return {
      ...r,
      rank,
      rank_bucket:
        rank === 1 ? "#1" : rank <= 3 ? "Top 3" : rank <= 5 ? "Top 5" : "Resto",
    };
  });
  const view = parseViewParam(searchParams, "sp_view");
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "name",
    layout: "horizontal",
    series: [{ dataKey: "total_amount", label: "Total MXN" }],
    valueFormat: "currency-compact",
    colorBy: "rank_bucket",
    colorMap: {
      "#1": "var(--chart-4)",
      "Top 3": "var(--chart-3)",
      "Top 5": "var(--chart-2)",
      Resto: "var(--chart-1)",
    },
    height: Math.max(260, ranked.length * 28 + 40),
  };
  return (
    <DataView
      data={ranked}
      columns={salespersonColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildVentasHref(searchParams, {
          sp_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => r.name}
      mobileCard={(r) => (
        <MobileCard
          title={`#${r.rank} ${r.name}`}
          badge={
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">
              <Currency amount={r.total_amount} compact />
            </span>
          }
          fields={[
            { label: "Pedidos", value: r.order_count },
            {
              label: "Promedio",
              value: (
                <Currency
                  amount={
                    r.order_count > 0 ? r.total_amount / r.order_count : 0
                  }
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

// ──────────────────────────────────────────────────────────────────────────
// Recent sale orders
// ──────────────────────────────────────────────────────────────────────────
const orderColumns: DataTableColumn<RecentSaleOrder>[] = [
  {
    key: "name",
    header: "Pedido",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "company",
    header: "Cliente",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink
          companyId={r.company_id}
          name={r.company_name}
          truncate
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "amount",
    header: "Monto",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums">
        <Currency amount={r.amount_total_mxn} />
      </span>
    ),
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

const saleOrderViewColumns = [
  { key: "name", label: "Pedido", alwaysVisible: true },
  { key: "company", label: "Cliente" },
  { key: "salesperson", label: "Vendedor" },
  { key: "amount", label: "Monto" },
  { key: "date", label: "Fecha" },
  { key: "state", label: "Estado" },
];

async function SaleOrdersToolbar() {
  const salespeople = await getSaleOrderSalespeopleOptions();
  return (
    <DataTableToolbar
      paramPrefix="so_"
      searchPlaceholder="Buscar pedido…"
      dateRange={{ label: "Fecha pedido" }}
      facets={[
        {
          key: "state",
          label: "Estado",
          options: [
            { value: "draft", label: "Borrador" },
            { value: "sent", label: "Enviado" },
            { value: "sale", label: "Confirmado" },
            { value: "done", label: "Hecho" },
            { value: "cancel", label: "Cancelado" },
          ],
        },
        {
          key: "salesperson",
          label: "Vendedor",
          options: salespeople.map((s) => ({ value: s, label: s })),
        },
      ]}
    />
  );
}

async function RecentOrdersTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "so_",
    facetKeys: ["state", "salesperson"],
    defaultSize: 25,
    defaultSort: "-date",
  });
  const [{ rows, total }, timeline] = await Promise.all([
    getSaleOrdersPage({
      ...params,
      state: params.facets.state,
      salesperson: params.facets.salesperson,
    }),
    getSaleOrdersTimeline({
      from: params.from,
      to: params.to,
      q: params.q,
      state: params.facets.state,
      salesperson: params.facets.salesperson,
    }),
  ]);
  const visibleKeys = parseVisibleKeys(searchParams, "so_");
  const sortHref = makeSortHref({
    pathname: "/ventas",
    searchParams,
    paramPrefix: "so_",
  });
  const view = parseViewParam(searchParams, "so_view");
  const chart: DataViewChartSpec = {
    type: "area",
    xKey: "week",
    stacked: true,
    series: [
      { dataKey: "sale", label: "Confirmado", color: "var(--chart-2)" },
      { dataKey: "done", label: "Hecho", color: "var(--chart-1)" },
      { dataKey: "sent", label: "Enviado", color: "var(--chart-3)" },
      {
        dataKey: "draft",
        label: "Borrador",
        color: "var(--muted-foreground)",
      },
      {
        dataKey: "cancel",
        label: "Cancelado",
        color: "var(--destructive)",
      },
    ],
    valueFormat: "currency-compact",
  };
  return (
    <div className="space-y-3">
    <DataView
      data={rows}
      columns={orderColumns}
      chart={chart}
      chartData={timeline as unknown as Record<string, unknown>[]}
      view={view}
      viewHref={(next) =>
        buildVentasHref(searchParams, {
          so_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.id)}
      rowHref={(r) =>
        r.company_id ? `/companies/${r.company_id}` : null
      }
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
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
            { label: "Monto", value: <Currency amount={r.amount_total_mxn} /> },
            {
              label: "Fecha",
              value: <DateDisplay date={r.date_order} relative />,
            },
            {
              label: "Vendedor",
              value: r.salesperson_name ?? "—",
              className: "col-span-2",
            },
          ]}
        />
      )}
      emptyState={{
        icon: ShoppingCart,
        title: "Sin pedidos",
        description: "Ajusta los filtros o el rango de fechas.",
      }}
    />
    <DataTablePagination
      paramPrefix="so_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="pedidos"
    />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Retención por cohorte (heatmap)
// ──────────────────────────────────────────────────────────────────────────
function formatCohortLabel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function retentionPct(
  cell: { active_customers: number } | null,
  base: number
): number | null {
  if (!cell || base === 0) return null;
  return (cell.active_customers / base) * 100;
}

/**
 * Heatmap cell: gradient single-hue usando `color-mix` contra --chart-2.
 * Opacidad mapea linealmente el % de retención (0% → 8%, 100% → 88%).
 * Consistente con la paleta shadcn del resto de gráficas.
 */
function cellStyle(pct: number | null): React.CSSProperties {
  if (pct == null) {
    return { backgroundColor: "var(--muted)", opacity: 0.3 };
  }
  const clamped = Math.max(0, Math.min(100, pct));
  // Non-linear: acentúa diferencias en el rango bajo (donde está el riesgo).
  const weight = Math.round(8 + (clamped / 100) * 80);
  return {
    backgroundColor: `color-mix(in oklab, var(--chart-2) ${weight}%, transparent)`,
  };
}

const COHORT_LEGEND: Array<{ label: string; pct: number }> = [
  { label: "0%", pct: 0 },
  { label: "25%", pct: 25 },
  { label: "50%", pct: 50 },
  { label: "75%", pct: 75 },
  { label: "100%", pct: 100 },
];

async function CohortHeatmapSection() {
  const data = await getCustomerCohorts(36);
  if (data.cohorts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin cohorts disponibles"
        description="customer_cohorts no tiene datos en los últimos 3 años."
        compact
      />
    );
  }
  return <RetentionTable data={data} />;
}

function RetentionTable({ data }: { data: CohortMatrix }) {
  const { cohorts, maxQuarters, matrix, baseSize } = data;
  return (
    <div className="space-y-3">
      <Table className="min-w-[640px] border-collapse text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-20 bg-background px-3 py-2 text-left font-semibold">
              Cohort
            </TableHead>
            <TableHead className="sticky top-0 z-10 bg-background px-2 py-2 text-right font-semibold">
              #
            </TableHead>
            {Array.from({ length: maxQuarters + 1 }).map((_, q) => (
              <TableHead
                key={q}
                className="sticky top-0 z-10 bg-background px-2 py-2 text-center font-semibold"
              >
                Q+{q}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {cohorts.map((cohort, i) => (
            <TableRow key={cohort}>
              <TableCell className="sticky left-0 z-10 bg-background px-3 py-2 font-mono">
                {formatCohortLabel(cohort)}
              </TableCell>
              <TableCell className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                {baseSize[i]}
              </TableCell>
              {Array.from({ length: maxQuarters + 1 }).map((_, q) => {
                const cell = matrix[i][q];
                const pct = retentionPct(cell, baseSize[i]);
                return (
                  <TableCell
                    key={q}
                    className={`px-2 py-2 text-center tabular-nums ${
                      pct != null
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground"
                    }`}
                    style={cellStyle(pct)}
                    title={
                      cell
                        ? `${cell.active_customers}/${baseSize[i]} clientes activos`
                        : "Sin data"
                    }
                  >
                    {pct != null ? `${pct.toFixed(0)}%` : "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 pt-2 text-[11px] text-muted-foreground">
        <span>Retención</span>
        <div className="flex overflow-hidden rounded border border-border">
          {COHORT_LEGEND.map((step) => (
            <div
              key={step.pct}
              className="flex h-5 w-10 items-center justify-center text-foreground"
              style={cellStyle(step.pct)}
            >
              {step.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
