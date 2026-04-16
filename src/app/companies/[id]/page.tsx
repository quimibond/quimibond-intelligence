import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  Calendar,
  Eye,
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
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  Currency,
  DateDisplay,
  StatusBadge,
  EmptyState,
  EvidencePackView,
  makeSortHref,
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
  getCompanyOrdersPage,
  getCompanyInvoicesPage,
  getCompanyDeliveriesPage,
  getCompanyTopProducts,
  getCompanyActivities,
  type CompanyOrderRow,
  type CompanyInvoiceRow,
  type CompanyDeliveryRow,
  type CompanyProductRow,
  type CompanyActivityRow,
} from "@/lib/queries/companies";
import { getCompanyEvidencePack } from "@/lib/queries/evidence";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";

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

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const company = await getCompanyDetail(id);
  if (!company) notFound();

  // M8: /companies/[id] para empresas self (Quimibond + variantes
  // Google Drive/Chat) renderizaba métricas vacías. Ahora muestra un
  // banner claro — análisis comercial no aplica a empresas internas.
  if (company.isSelf) {
    return (
      <div className="space-y-5 pb-24 md:pb-6">
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Empresas", href: "/companies" },
            { label: company.name },
          ]}
          title={company.name}
          subtitle="Empresa interna"
          actions={
            <Badge variant="secondary">Interna</Badge>
          }
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-10 text-muted-foreground" />
            <h3 className="text-base font-semibold">Esta es una empresa interna</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {company.name} está marcada como <code className="rounded bg-muted px-1">relationship_type=self</code> —
              no aplica análisis comercial (revenue, cartera, reorder, etc.). Las
              empresas externas se ven en{" "}
              <a href="/companies" className="underline hover:text-primary">
                /companies
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Header con breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Empresas", href: "/companies" },
          { label: company.name },
        ]}
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

      {/* Tabs — cada una contesta una pregunta específica sobre esta empresa */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview" className="gap-1.5">
            <Eye className="size-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="finance" className="gap-1.5">
            <FileText className="size-3.5" />
            Finanzas
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5">
            <ShoppingCart className="size-3.5" />
            Pedidos
          </TabsTrigger>
          <TabsTrigger value="products" className="gap-1.5">
            <Package className="size-3.5" />
            Productos
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <Activity className="size-3.5" />
            Actividad
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Suspense fallback={<OverviewSkeleton />}>
            <OverviewEvidenceSection companyId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="finance" className="mt-4 space-y-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Facturas</CardTitle>
                <p className="text-xs text-muted-foreground">
                  ¿Qué me debe este cliente y cuánto lleva vencido?
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TableViewOptions
                  paramPrefix="ci_"
                  columns={companyInvoicesViewColumns}
                />
                <TableExportButton
                  filename={`${company.name}-invoices`}
                />
              </div>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<TabTableSkeleton rows={8} />}>
                <InvoicesSection companyId={id} searchParams={sp} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="mt-4 space-y-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Pedidos</CardTitle>
                <p className="text-xs text-muted-foreground">
                  ¿Qué me ha comprado y cómo van las órdenes abiertas?
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TableViewOptions
                  paramPrefix="co_"
                  columns={companyOrdersViewColumns}
                />
                <TableExportButton filename={`${company.name}-orders`} />
              </div>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<TabTableSkeleton rows={8} />}>
                <OrdersSection companyId={id} searchParams={sp} />
              </Suspense>
            </CardContent>
          </Card>
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Entregas</CardTitle>
                <p className="text-xs text-muted-foreground">
                  ¿Estamos entregando a tiempo? ¿Qué quedó pendiente?
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TableViewOptions
                  paramPrefix="cd_"
                  columns={companyDeliveriesViewColumns}
                />
                <TableExportButton
                  filename={`${company.name}-deliveries`}
                />
              </div>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<TabTableSkeleton rows={6} />}>
                <DeliveriesSection companyId={id} searchParams={sp} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Top productos comprados
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                ¿Qué productos le importan a este cliente? Ordenados por
                revenue en los últimos 12 meses.
              </p>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<TabTableSkeleton rows={8} />}>
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
              <p className="text-xs text-muted-foreground">
                Tareas asignadas a alguien del equipo con deadline pendiente
                relacionadas con este cliente.
              </p>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<TabTableSkeleton rows={6} />}>
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
function TabTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}

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
  if (pack.is_self) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Esta es la propia Quimibond"
        description="Esta empresa esta marcada como relationship_type='self'. Las facturas, ordenes y cobranza que aparezcan aqui son inter-company y no representan negocio externo."
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
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Fecha",
    sortable: true,
    cell: (r) => <DateDisplay date={r.invoice_date} />,
    hideOnMobile: true,
  },
  {
    key: "due",
    header: "Vence",
    sortable: true,
    cell: (r) => <DateDisplay date={r.due_date} />,
  },
  {
    key: "total",
    header: "Total",
    sortable: true,
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
  },
  {
    key: "residual",
    header: "Saldo",
    sortable: true,
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
    key: "days",
    header: "Días",
    defaultHidden: true,
    sortable: true,
    cell: (r) =>
      r.days_overdue && r.days_overdue > 0 ? (
        <span className="font-semibold text-danger tabular-nums">
          {r.days_overdue}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => (
      <StatusBadge status={(r.payment_state ?? "pending") as "paid"} />
    ),
  },
];

const companyInvoicesViewColumns = [
  { key: "name", label: "Factura", alwaysVisible: true },
  { key: "date", label: "Fecha" },
  { key: "due", label: "Vence" },
  { key: "total", label: "Total" },
  { key: "residual", label: "Saldo" },
  { key: "days", label: "Días vencido", defaultHidden: true },
  { key: "state", label: "Estado" },
];

async function InvoicesSection({
  companyId,
  searchParams,
}: {
  companyId: number;
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "ci_",
    defaultSize: 25,
    defaultSort: "-date",
  });
  const { rows, total } = await getCompanyInvoicesPage(companyId, params);
  const visibleKeys = parseVisibleKeys(searchParams, "ci_");
  const sortHref = makeSortHref({
    pathname: `/companies/${companyId}`,
    searchParams,
    paramPrefix: "ci_",
  });
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={invoiceColumns}
      rowKey={(r) => String(r.id)}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
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
    <DataTablePagination
      paramPrefix="ci_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="facturas"
    />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Orders tab
// ──────────────────────────────────────────────────────────────────────────
const companyOrdersViewColumns = [
  { key: "name", label: "Pedido", alwaysVisible: true },
  { key: "date", label: "Fecha" },
  { key: "amount", label: "Monto" },
  { key: "salesperson", label: "Vendedor" },
  { key: "state", label: "Estado" },
];

const orderColumns: DataTableColumn<CompanyOrderRow>[] = [
  {
    key: "name",
    header: "Pedido",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Fecha",
    sortable: true,
    cell: (r) => <DateDisplay date={r.date_order} />,
  },
  {
    key: "amount",
    header: "Monto",
    sortable: true,
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
    sortable: true,
    cell: (r) => <StatusBadge status={(r.state ?? "draft") as "draft"} />,
  },
];

async function OrdersSection({
  companyId,
  searchParams,
}: {
  companyId: number;
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "co_",
    defaultSize: 25,
    defaultSort: "-date",
  });
  const { rows, total } = await getCompanyOrdersPage(companyId, params);
  const visibleKeys = parseVisibleKeys(searchParams, "co_");
  const sortHref = makeSortHref({
    pathname: `/companies/${companyId}`,
    searchParams,
    paramPrefix: "co_",
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
    <DataTablePagination
      paramPrefix="co_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="pedidos"
    />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries
// ──────────────────────────────────────────────────────────────────────────
const companyDeliveriesViewColumns = [
  { key: "name", label: "Movimiento", alwaysVisible: true },
  { key: "type", label: "Tipo" },
  { key: "scheduled", label: "Programada" },
  { key: "done", label: "Completada", defaultHidden: true },
  { key: "state", label: "Estado" },
];

const deliveryColumns: DataTableColumn<CompanyDeliveryRow>[] = [
  {
    key: "name",
    header: "Movimiento",
    alwaysVisible: true,
    sortable: true,
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
    sortable: true,
    cell: (r) => <DateDisplay date={r.scheduled_date} />,
  },
  {
    key: "done",
    header: "Completada",
    defaultHidden: true,
    sortable: true,
    cell: (r) => <DateDisplay date={r.date_done} />,
  },
  {
    key: "state",
    header: "Estado",
    sortable: true,
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

async function DeliveriesSection({
  companyId,
  searchParams,
}: {
  companyId: number;
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "cd_",
    defaultSize: 25,
    defaultSort: "-scheduled",
  });
  const { rows, total } = await getCompanyDeliveriesPage(companyId, params);
  const visibleKeys = parseVisibleKeys(searchParams, "cd_");
  const sortHref = makeSortHref({
    pathname: `/companies/${companyId}`,
    searchParams,
    paramPrefix: "cd_",
  });
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={deliveryColumns}
      rowKey={(r) => String(r.id)}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
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
    <DataTablePagination
      paramPrefix="cd_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="entregas"
    />
    </div>
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
