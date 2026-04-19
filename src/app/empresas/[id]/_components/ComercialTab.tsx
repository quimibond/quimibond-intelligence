import { Suspense } from "react";
import { Package, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  Currency,
  DateDisplay,
  StatusBadge,
  makeSortHref,
  type DataTableColumn,
} from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import {
  getCompanyTopProducts,
  getCompanyOrdersPage,
  type CompanyProductRow,
  type CompanyOrderRow,
} from "@/lib/queries/companies";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import type { CompanyDetail } from "@/lib/queries/companies";

type SearchParams = Record<string, string | string[] | undefined>;

interface Props {
  company: CompanyDetail;
  searchParams: SearchParams;
}

// ──────────────────────────────────────────────────────────────────────────
// Products section
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
// Orders section
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
// Comercial tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function ComercialTab({ company, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Top productos comprados</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ordenados por revenue en los últimos 12 meses.
              </p>
            </div>
            <DataSourceBadge source="odoo" refresh="1h" />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <ProductsSection companyId={company.id} />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Órdenes de venta</CardTitle>
            <p className="text-xs text-muted-foreground">
              ¿Qué ha comprado y cómo van las órdenes abiertas?
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source="odoo" refresh="1h" />
            <TableViewOptions
              paramPrefix="co_"
              columns={companyOrdersViewColumns}
            />
            <TableExportButton filename={`${company.name}-orders`} />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <OrdersSection companyId={company.id} searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
