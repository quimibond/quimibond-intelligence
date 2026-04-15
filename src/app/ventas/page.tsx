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
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  StatusBadge,
  TrendIndicator,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getSalesKpis,
  getSalesRevenueTrend,
  getReorderRisk,
  getTopCustomers,
  getTopSalespeople,
  getSaleOrdersPage,
  getSaleOrderSalespeopleOptions,
  type ReorderRiskRow,
  type TopCustomerRow,
  type SalespersonRow,
  type RecentSaleOrder,
} from "@/lib/queries/sales";
import { parseTableParams } from "@/lib/queries/table-params";
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Reorder risk — clientes que deberían haber comprado
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <ReorderRiskTable />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top clientes (revenue 90d)
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <TopCustomersTable />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ranking de vendedores este mes
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[200px] rounded-xl" />}>
            <SalespeopleTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedidos</CardTitle>
          <p className="text-xs text-muted-foreground">
            Busca por número o filtra por vendedor, estado y fecha. Datos en
            vivo de Odoo.
          </p>
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

const reorderColumns: DataTableColumn<ReorderRiskRow>[] = [
  {
    key: "company",
    header: "Cliente",
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
    key: "days",
    header: "Días vencido",
    cell: (r) => (
      <span className="font-semibold tabular-nums text-warning-foreground">
        {r.days_overdue_reorder ? Math.round(r.days_overdue_reorder) : "—"}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "total_revenue",
    header: "Revenue total",
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
];

async function ReorderRiskTable() {
  const rows = await getReorderRisk(20);
  return (
    <DataTable
      data={rows}
      columns={reorderColumns}
      rowKey={(r) => String(r.company_id)}
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
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top customers
// ──────────────────────────────────────────────────────────────────────────
const customerColumns: DataTableColumn<TopCustomerRow>[] = [
  {
    key: "company",
    header: "Cliente",
    cell: (r) => (
      <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
    ),
  },
  {
    key: "revenue_90d",
    header: "Revenue 90d",
    cell: (r) => <Currency amount={r.revenue_90d} compact />,
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
          className={
            r.margin_pct_12m >= 25
              ? "text-success"
              : r.margin_pct_12m >= 15
                ? "text-warning"
                : "text-danger"
          }
        >
          {r.margin_pct_12m.toFixed(1)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
];

async function TopCustomersTable() {
  const rows = await getTopCustomers(15);
  return (
    <DataTable
      data={rows}
      columns={customerColumns}
      rowKey={(r) => String(r.company_id)}
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
    cell: (r) => <span className="text-muted-foreground">#{r.rank}</span>,
  },
  {
    key: "name",
    header: "Vendedor",
    cell: (r) => <span className="font-semibold">{r.name}</span>,
  },
  {
    key: "orders",
    header: "Pedidos",
    cell: (r) => r.order_count,
    align: "right",
    hideOnMobile: true,
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
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
  },
  {
    key: "date",
    header: "Fecha",
    cell: (r) => <DateDisplay date={r.date_order} relative />,
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => <StatusBadge status={(r.state ?? "draft") as "draft"} />,
  },
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
  searchParams: Record<string, string | string[] | undefined>;
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
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={orderColumns}
      rowKey={(r) => String(r.id)}
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
