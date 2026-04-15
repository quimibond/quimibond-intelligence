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
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getPurchasesKpis,
  getSingleSourceRisk,
  getPriceAnomalies,
  getPurchaseOrdersPage,
  getPurchaseBuyerOptions,
  getTopSuppliers,
  type SingleSourceRow,
  type PriceAnomalyRow,
  type RecentPurchaseOrder,
  type TopSupplierRow,
} from "@/lib/queries/purchases";
import { parseTableParams } from "@/lib/queries/table-params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compras" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Compras"
        subtitle="Pedidos, riesgo de proveedor único y anomalías de precio"
      />

      {/* Sub-nav a páginas especializadas */}
      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href="/compras/price-variance"
          className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium hover:bg-muted"
        >
          Variancia de precios
        </a>
        <a
          href="/compras/stockouts"
          className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium hover:bg-muted"
        >
          Cola de stockouts
        </a>
        <a
          href="/compras/costos-bom"
          className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium hover:bg-muted"
        >
          Costos de BOM
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
        <PurchasesKpisSection />
      </Suspense>

      {/* Single source risk — la sección crítica */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Riesgo de proveedor único
          </CardTitle>
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
            <SingleSourceTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Price anomalies */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Anomalías de precio
          </CardTitle>
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
            <PriceAnomaliesTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top proveedores (12m)</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <TopSuppliersTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes de compra</CardTitle>
          <p className="text-xs text-muted-foreground">
            Busca por número o filtra por comprador, estado y fecha.
          </p>
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
    </div>
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

const singleSourceColumns: DataTableColumn<SingleSourceRow>[] = [
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
    key: "spent",
    header: "Spent 12m",
    cell: (r) => <Currency amount={r.total_spent_12m} compact />,
    align: "right",
  },
];

async function SingleSourceTable() {
  const rows = await getSingleSourceRisk(30);
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
  return (
    <DataTable
      data={rows}
      columns={singleSourceColumns}
      rowKey={(r) => String(r.odoo_product_id)}
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
              value:
                r.top_supplier_company_id && r.top_supplier_name ? (
                  <CompanyLink
                    companyId={r.top_supplier_company_id}
                    name={r.top_supplier_name}
                    truncate
                  />
                ) : (
                  (r.top_supplier_name ?? "—")
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

const priceColumns: DataTableColumn<PriceAnomalyRow>[] = [
  {
    key: "ref",
    header: "Ref",
    cell: (r) => (
      <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>
    ),
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
    cell: (r) =>
      r.price_vs_avg_pct != null ? (
        <span
          className={
            r.price_vs_avg_pct > 0 ? "text-danger font-semibold" : "text-info"
          }
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
    key: "last_price",
    header: "Último",
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
    key: "spent",
    header: "Total",
    cell: (r) => <Currency amount={r.total_spent} compact />,
    align: "right",
  },
];

async function PriceAnomaliesTable() {
  const rows = await getPriceAnomalies(30);
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
  return (
    <DataTable
      data={rows}
      columns={priceColumns}
      rowKey={(r, i) => `${r.product_ref ?? "p"}-${i}`}
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
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top suppliers
// ──────────────────────────────────────────────────────────────────────────
const supplierColumns: DataTableColumn<TopSupplierRow>[] = [
  {
    key: "name",
    header: "Proveedor",
    cell: (r) => <span className="font-semibold truncate">{r.supplier_name}</span>,
  },
  {
    key: "spent",
    header: "Total",
    cell: (r) => <Currency amount={r.total_spent} compact />,
    align: "right",
  },
  {
    key: "products",
    header: "Productos",
    cell: (r) => r.product_count,
    align: "right",
    hideOnMobile: true,
  },
];

async function TopSuppliersTable() {
  const rows = await getTopSuppliers(15);
  return (
    <DataTable
      data={rows}
      columns={supplierColumns}
      rowKey={(r) => r.supplier_name}
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
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Recent purchases (kept)
// ──────────────────────────────────────────────────────────────────────────
const orderColumns: DataTableColumn<RecentPurchaseOrder>[] = [
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
  const { rows, total } = await getPurchaseOrdersPage({
    ...params,
    state: params.facets.state,
    buyer: params.facets.buyer,
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
      <DataTablePagination
        paramPrefix="po_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="órdenes"
      />
    </div>
  );
}
