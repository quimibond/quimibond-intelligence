import { Suspense } from "react";
import { FileText, ShoppingCart, TrendingUp, User } from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  StatusBadge,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { getSalesKpis, getRecentSaleOrders, type RecentSaleOrder } from "@/lib/queries/sales";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventas" };

export default function VentasPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Ventas"
        subtitle="Pedidos de venta y revenue del mes"
      />

      <Suspense fallback={<StatsSkeleton />}>
        <VentasKpis />
      </Suspense>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Pedidos recientes</h2>
        <Suspense
          fallback={
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          }
        >
          <RecentOrdersTable />
        </Suspense>
      </section>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[96px] rounded-xl" />
      ))}
    </StatGrid>
  );
}

async function VentasKpis() {
  const k = await getSalesKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Ventas del mes"
        value={k.monthTotal}
        format="currency"
        compact
        icon={TrendingUp}
        trend={{ value: k.trendPct, good: "up" }}
        subtitle="vs mes anterior"
        tone={k.trendPct >= 0 ? "success" : "warning"}
      />
      <KpiCard
        title="Pedidos"
        value={k.orderCount}
        format="number"
        icon={ShoppingCart}
        subtitle="en el mes"
      />
      <KpiCard
        title="Ticket promedio"
        value={k.avgOrderValue}
        format="currency"
        compact
        icon={FileText}
      />
      <KpiCard
        title="Top vendedor"
        value={k.topSalesperson ?? "—"}
        icon={User}
        size="sm"
      />
    </StatGrid>
  );
}

const columns: DataTableColumn<RecentSaleOrder>[] = [
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
    cell: (r) => <StatusBadge status={r.state ?? "draft"} />,
  },
];

async function RecentOrdersTable() {
  const rows = await getRecentSaleOrders(30);
  return (
    <DataTable
      data={rows}
      columns={columns}
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
          badge={<StatusBadge status={r.state ?? "draft"} />}
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
        title: "Sin pedidos recientes",
        description: "Aún no hay pedidos de venta en el sistema.",
      }}
    />
  );
}
