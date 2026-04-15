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
  DataTableToolbar,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  StatusBadge,
  TrendIndicator,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getSalesKpis,
  getSalesRevenueTrend,
  getReorderRiskPage,
  getTopCustomersPage,
  getTopSalespeople,
  getSaleOrdersPage,
  getSaleOrderSalespeopleOptions,
  type ReorderRiskRow,
  type TopCustomerRow,
  type SalespersonRow,
  type RecentSaleOrder,
} from "@/lib/queries/sales";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import { formatCurrencyMXN } from "@/lib/formatters";

import { SalesTrendChart } from "./_components/sales-trend-chart";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Ventas" };

type SearchParams = Record<string, string | string[] | undefined>;

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
        subtitle="Ingresos del mes, reorder risk y pipeline"
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href="/ventas/cohorts"
          className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium hover:bg-muted"
        >
          Retención por cohorte
        </a>
      </div>

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
            <SalespeopleTable />
          </Suspense>
        </CardContent>
      </Card>

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
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
async function SalesKpisSection() {
  const k = await getSalesKpis();
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
      />
      <KpiCard
        title="Utilidad operativa"
        value={k.utilidadOperativaMes}
        format="currency"
        compact
        icon={k.utilidadOperativaMes >= 0 ? ArrowUpRight : ArrowDownRight}
        subtitle="del mes"
        tone={k.utilidadOperativaMes >= 0 ? "success" : "danger"}
      />
      <KpiCard
        title="YoY"
        value={k.ingresosYoyPct}
        format="percent"
        icon={TrendingUp}
        subtitle={`vs ${formatCurrencyMXN(k.ingresosYoy, { compact: true })} año pasado`}
        tone={k.ingresosYoyPct >= 0 ? "success" : "danger"}
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
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={reorderColumns}
      rowKey={(r) => String(r.company_id)}
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
  { key: "margin_pct", label: "% Margen" },
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
  },
  {
    key: "revenue_total",
    header: "Revenue lifetime",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <Currency amount={r.total_revenue_lifetime} compact />,
    align: "right",
  },
  {
    key: "margin_12m",
    header: "Margen 12m",
    cell: (r) =>
      r.margin_12m != null ? <Currency amount={r.margin_12m} compact /> : "—",
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "margin_pct",
    header: "% Margen",
    cell: (r) =>
      r.margin_pct_12m != null ? (
        <span
          className={`tabular-nums ${
            r.margin_pct_12m >= 25
              ? "text-success"
              : r.margin_pct_12m >= 15
                ? "text-warning"
                : "text-danger"
          }`}
        >
          {r.margin_pct_12m.toFixed(1)}%
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
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={customerColumns}
      rowKey={(r) => String(r.company_id)}
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
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => <Currency amount={r.total_amount} compact />,
    align: "right",
  },
];

async function SalespeopleTable() {
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
  const ranked: SalespersonRanked[] = rows.map((r, i) => ({
    ...r,
    rank: i + 1,
  }));
  return (
    <DataTable
      data={ranked}
      columns={salespersonColumns}
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
  const { rows, total } = await getSaleOrdersPage({
    ...params,
    state: params.facets.state,
    salesperson: params.facets.salesperson,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "so_");
  const sortHref = makeSortHref({
    pathname: "/ventas",
    searchParams,
    paramPrefix: "so_",
  });
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={orderColumns}
      rowKey={(r) => String(r.id)}
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
