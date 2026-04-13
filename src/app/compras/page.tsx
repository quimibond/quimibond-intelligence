import { Suspense } from "react";
import { Banknote, ShoppingBag, TrendingUp, Truck } from "lucide-react";

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
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPurchasesKpis,
  getRecentPurchaseOrders,
  type RecentPurchaseOrder,
} from "@/lib/queries/purchases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compras" };

export default function ComprasPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Compras"
        subtitle="Órdenes de compra y cuentas por pagar"
      />

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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Compras recientes</h2>
        <Suspense
          fallback={
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          }
        >
          <RecentPurchasesTable />
        </Suspense>
      </section>
    </div>
  );
}

async function PurchasesKpisSection() {
  const k = await getPurchasesKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Compras del mes"
        value={k.monthTotal}
        format="currency"
        compact
        icon={TrendingUp}
        trend={{ value: k.trendPct, good: "down" }}
        subtitle="vs mes anterior"
      />
      <KpiCard
        title="Órdenes"
        value={k.poCount}
        icon={ShoppingBag}
        format="number"
      />
      <KpiCard
        title="Por pagar"
        value={k.supplierPayable}
        icon={Banknote}
        format="currency"
        compact
        tone={k.supplierPayable > 0 ? "warning" : "default"}
      />
      <KpiCard title="Entregas" value={0} icon={Truck} format="number" size="sm" />
    </StatGrid>
  );
}

const columns: DataTableColumn<RecentPurchaseOrder>[] = [
  {
    key: "name",
    header: "Orden",
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

async function RecentPurchasesTable() {
  const rows = await getRecentPurchaseOrders(30);
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
            { label: "Fecha", value: <DateDisplay date={r.date_order} relative /> },
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
        title: "Sin órdenes de compra",
        description: "No hay compras registradas.",
      }}
    />
  );
}
