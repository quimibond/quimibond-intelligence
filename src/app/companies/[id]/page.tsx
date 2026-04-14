import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  FileText,
  Mail,
  Package,
  ShoppingCart,
  Truck,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  Currency,
  DateDisplay,
  StatusBadge,
  EmptyState,
  EvidencePackView,
  type DataTableColumn,
} from "@/components/shared/v2";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getCompanyDetail,
  getCompanyOrders,
  getCompanyInvoices,
  getCompanyDeliveries,
  getCompanyTopProducts,
  getCompanyActivities,
  type CompanyOrderRow,
  type CompanyInvoiceRow,
  type CompanyDeliveryRow,
  type CompanyProductRow,
  type CompanyActivityRow,
} from "@/lib/queries/companies";
import { getCompanyEvidencePack } from "@/lib/queries/evidence";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await getCompanyDetail(Number(id));
  return { title: company?.name ?? "Empresa" };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const company = await getCompanyDetail(id);
  if (!company) notFound();

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Back link */}
      <Link
        href="/companies"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Todas las empresas
      </Link>

      {/* Header */}
      <PageHeader
        title={company.name}
        subtitle={
          [company.industry, company.city, company.rfc]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <div className="flex gap-2">
            {company.tier && (
              <Badge
                variant={
                  company.tier === "A"
                    ? "success"
                    : company.tier === "B"
                      ? "info"
                      : "secondary"
                }
              >
                Pareto {company.tier}
              </Badge>
            )}
            {company.isCustomer && <Badge variant="info">Cliente</Badge>}
            {company.isSupplier && (
              <Badge variant="secondary">Proveedor</Badge>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Revenue total"
          value={company.totalRevenue}
          format="currency"
          compact
          icon={TrendingUp}
        />
        <KpiCard
          title="Revenue 90d"
          value={company.revenue90d}
          format="currency"
          compact
          icon={TrendingUp}
          trend={
            company.trendPct !== 0
              ? { value: company.trendPct, good: "up" }
              : undefined
          }
        />
        <KpiCard
          title="Cartera vencida"
          value={company.overdueAmount}
          format="currency"
          compact
          icon={AlertTriangle}
          subtitle={
            company.maxDaysOverdue
              ? `máx ${company.maxDaysOverdue} días`
              : "—"
          }
          tone={company.overdueAmount > 0 ? "danger" : "default"}
        />
        <KpiCard
          title="OTD"
          value={company.otdRate}
          format="percent"
          icon={Truck}
          subtitle={`${company.lateDeliveries} tardías`}
          tone={
            company.otdRate == null
              ? "default"
              : company.otdRate >= 90
                ? "success"
                : company.otdRate >= 75
                  ? "warning"
                  : "danger"
          }
        />
      </StatGrid>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="finance">Finanzas</TabsTrigger>
          <TabsTrigger value="orders">Pedidos</TabsTrigger>
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="activity">Actividad</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Suspense fallback={<OverviewSkeleton />}>
            <OverviewEvidenceSection companyId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="finance" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Facturas recientes</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <InvoicesSection companyId={id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pedidos recientes</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <OrdersSection companyId={id} />
              </Suspense>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entregas</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[240px]" />}>
                <DeliveriesSection companyId={id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top productos comprados</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <ProductsSection companyId={id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Actividades pendientes
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[240px]" />}>
                <ActivitiesSection companyId={id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Overview tab — evidence pack cruzado
// ──────────────────────────────────────────────────────────────────────────
function OverviewSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

async function OverviewEvidenceSection({ companyId }: { companyId: number }) {
  const pack = await getCompanyEvidencePack(companyId);
  if (!pack) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin evidence pack"
        description="No se pudo cargar el company_evidence_pack para esta empresa."
      />
    );
  }
  return <EvidencePackView pack={pack} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Invoices tab
// ──────────────────────────────────────────────────────────────────────────
const invoiceColumns: DataTableColumn<CompanyInvoiceRow>[] = [
  {
    key: "name",
    header: "Factura",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Fecha",
    cell: (r) => <DateDisplay date={r.invoice_date} />,
    hideOnMobile: true,
  },
  {
    key: "due",
    header: "Vence",
    cell: (r) => <DateDisplay date={r.due_date} />,
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
  },
  {
    key: "residual",
    header: "Saldo",
    cell: (r) =>
      r.amount_residual_mxn && r.amount_residual_mxn > 0 ? (
        <Currency amount={r.amount_residual_mxn} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => (
      <StatusBadge status={(r.payment_state ?? "pending") as "paid"} />
    ),
  },
];

async function InvoicesSection({ companyId }: { companyId: number }) {
  const rows = await getCompanyInvoices(companyId, 30);
  return (
    <DataTable
      data={rows}
      columns={invoiceColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={<DateDisplay date={r.invoice_date} />}
          badge={
            <StatusBadge status={(r.payment_state ?? "pending") as "paid"} />
          }
          fields={[
            {
              label: "Total",
              value: <Currency amount={r.amount_total_mxn} />,
            },
            {
              label: "Saldo",
              value: <Currency amount={r.amount_residual_mxn} />,
            },
            { label: "Vence", value: <DateDisplay date={r.due_date} /> },
            {
              label: "Días vencido",
              value: r.days_overdue && r.days_overdue > 0 ? r.days_overdue : "—",
              className: r.days_overdue && r.days_overdue > 0 ? "text-danger" : "",
            },
          ]}
        />
      )}
      emptyState={{
        icon: FileText,
        title: "Sin facturas",
        description: "No hay facturas registradas para esta empresa.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Orders tab
// ──────────────────────────────────────────────────────────────────────────
const orderColumns: DataTableColumn<CompanyOrderRow>[] = [
  {
    key: "name",
    header: "Pedido",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Fecha",
    cell: (r) => <DateDisplay date={r.date_order} />,
  },
  {
    key: "amount",
    header: "Monto",
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => <StatusBadge status={(r.state ?? "draft") as "draft"} />,
  },
];

async function OrdersSection({ companyId }: { companyId: number }) {
  const rows = await getCompanyOrders(companyId, 30);
  return (
    <DataTable
      data={rows}
      columns={orderColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={r.salesperson_name ?? undefined}
          badge={<StatusBadge status={(r.state ?? "draft") as "draft"} />}
          fields={[
            {
              label: "Monto",
              value: <Currency amount={r.amount_total_mxn} />,
            },
            { label: "Fecha", value: <DateDisplay date={r.date_order} /> },
          ]}
        />
      )}
      emptyState={{
        icon: ShoppingCart,
        title: "Sin pedidos",
        description: "No hay pedidos registrados.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries
// ──────────────────────────────────────────────────────────────────────────
const deliveryColumns: DataTableColumn<CompanyDeliveryRow>[] = [
  {
    key: "name",
    header: "Movimiento",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "type",
    header: "Tipo",
    cell: (r) =>
      r.picking_type_code === "outgoing"
        ? "Salida"
        : r.picking_type_code === "incoming"
          ? "Entrada"
          : "—",
    hideOnMobile: true,
  },
  {
    key: "scheduled",
    header: "Programada",
    cell: (r) => <DateDisplay date={r.scheduled_date} />,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) =>
      r.is_late ? (
        <StatusBadge status="overdue" />
      ) : r.date_done ? (
        <StatusBadge status="delivered" />
      ) : (
        <StatusBadge status={(r.state ?? "pending") as "pending"} />
      ),
  },
];

async function DeliveriesSection({ companyId }: { companyId: number }) {
  const rows = await getCompanyDeliveries(companyId, 20);
  return (
    <DataTable
      data={rows}
      columns={deliveryColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={
            r.picking_type_code === "outgoing"
              ? "Salida"
              : r.picking_type_code === "incoming"
                ? "Entrada"
                : undefined
          }
          badge={
            r.is_late ? (
              <StatusBadge status="overdue" />
            ) : r.date_done ? (
              <StatusBadge status="delivered" />
            ) : (
              <StatusBadge status={(r.state ?? "pending") as "pending"} />
            )
          }
          fields={[
            {
              label: "Programada",
              value: <DateDisplay date={r.scheduled_date} />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Truck,
        title: "Sin entregas",
        description: "No hay movimientos de inventario.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Products tab
// ──────────────────────────────────────────────────────────────────────────
const productColumns: DataTableColumn<CompanyProductRow>[] = [
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
  },
  {
    key: "qty",
    header: "Qty",
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.total_qty)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "revenue",
    header: "Revenue",
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "last",
    header: "Último",
    cell: (r) => <DateDisplay date={r.last_order_date} relative />,
    hideOnMobile: true,
  },
];

async function ProductsSection({ companyId }: { companyId: number }) {
  const rows = await getCompanyTopProducts(companyId, 15);
  return (
    <DataTable
      data={rows}
      columns={productColumns}
      rowKey={(r, i) => `${r.product_ref ?? "p"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          fields={[
            { label: "Qty", value: Math.round(r.total_qty) },
            {
              label: "Revenue",
              value: <Currency amount={r.total_revenue} compact />,
            },
            {
              label: "Último",
              value: <DateDisplay date={r.last_order_date} relative />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Package,
        title: "Sin productos",
        description: "No hay líneas de pedido para esta empresa.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Activities
// ──────────────────────────────────────────────────────────────────────────
const activityColumns: DataTableColumn<CompanyActivityRow>[] = [
  {
    key: "type",
    header: "Tipo",
    cell: (r) => r.activity_type ?? "—",
  },
  {
    key: "summary",
    header: "Resumen",
    cell: (r) => (
      <span className="truncate">{r.summary ?? "—"}</span>
    ),
  },
  {
    key: "deadline",
    header: "Vence",
    cell: (r) => <DateDisplay date={r.date_deadline} relative />,
  },
  {
    key: "assigned",
    header: "Asignado",
    cell: (r) => r.assigned_to ?? "—",
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) =>
      r.is_overdue ? (
        <StatusBadge status="overdue" />
      ) : (
        <StatusBadge status="pending" />
      ),
  },
];

async function ActivitiesSection({ companyId }: { companyId: number }) {
  const rows = await getCompanyActivities(companyId, 15);
  return (
    <DataTable
      data={rows}
      columns={activityColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.activity_type ?? r.summary ?? "—"}
          subtitle={r.summary ?? undefined}
          badge={
            r.is_overdue ? (
              <StatusBadge status="overdue" />
            ) : (
              <StatusBadge status="pending" />
            )
          }
          fields={[
            {
              label: "Vence",
              value: <DateDisplay date={r.date_deadline} relative />,
            },
            { label: "Asignado", value: r.assigned_to ?? "—" },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin actividades",
        description: "No hay actividades pendientes para esta empresa.",
      }}
    />
  );
}
