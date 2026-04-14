import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Flame,
  Package,
  PackageCheck,
  TrendingUp,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  Currency,
  DateDisplay,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getProductsKpis,
  getReorderNeeded,
  getTopMovers,
  getDeadStock,
  getTopMarginProducts,
  type ReorderRow,
  type TopMoverRow,
  type DeadStockRow,
  type TopMarginProductRow,
} from "@/lib/queries/products";
import { formatNumber } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Productos" };

export default function ProductosPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Productos"
        subtitle="Inventario, reorden urgente, dead stock y márgenes"
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
        <ProductsHeroKpis />
      </Suspense>

      {/* Reorder needed — la sección crítica para operaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Reorden urgente — productos que se acaban
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
            <ReorderTable />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top movers (90 días)
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <TopMoversTable />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top margen (revenue ponderado)
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <TopMarginTable />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Stock muerto (sin movimiento)
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <DeadStockTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero KPIs
// ──────────────────────────────────────────────────────────────────────────
async function ProductsHeroKpis() {
  const k = await getProductsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Catálogo activo"
        value={k.catalogActive}
        format="number"
        icon={Package}
      />
      <KpiCard
        title="Por reordenar"
        value={k.needsReorder}
        format="number"
        icon={Flame}
        subtitle="urgente + 30d + stockout"
        tone={k.needsReorder > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Sin movimiento"
        value={k.noMovementValue}
        format="currency"
        compact
        icon={Archive}
        subtitle={`${k.noMovementCount} productos`}
        tone="warning"
      />
      <KpiCard
        title="Margen promedio"
        value={k.avgMarginPct}
        format="percent"
        icon={TrendingUp}
        subtitle="bruto"
        tone={k.avgMarginPct >= 30 ? "success" : "warning"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder table
// ──────────────────────────────────────────────────────────────────────────
const reorderVariant: Record<string, "critical" | "warning" | "info"> = {
  stockout: "critical",
  urgent_14d: "critical",
  reorder_30d: "warning",
};
const reorderLabel: Record<string, string> = {
  stockout: "STOCKOUT",
  urgent_14d: "≤ 14 días",
  reorder_30d: "≤ 30 días",
};

const reorderColumns: DataTableColumn<ReorderRow>[] = [
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
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={reorderVariant[r.reorder_status] ?? "warning"}>
        {reorderLabel[r.reorder_status] ?? r.reorder_status}
      </Badge>
    ),
  },
  {
    key: "available",
    header: "Disponible",
    cell: (r) => <span className="tabular-nums">{Math.round(r.available_qty)}</span>,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "days_stock",
    header: "Días stock",
    cell: (r) =>
      r.days_of_stock != null ? (
        <span
          className={
            r.days_of_stock <= 14
              ? "font-bold text-danger"
              : r.days_of_stock <= 30
                ? "text-warning"
                : ""
          }
        >
          {Math.round(r.days_of_stock)}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "rate",
    header: "Daily rate",
    cell: (r) =>
      r.daily_run_rate != null ? r.daily_run_rate.toFixed(1) : "—",
    align: "right",
    hideOnMobile: true,
  },
];

async function ReorderTable() {
  const rows = await getReorderNeeded(40);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Sin reorden urgente"
        description="Todos los productos tienen stock suficiente."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={reorderColumns}
      rowKey={(r, i) => `${r.product_ref ?? "p"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? r.category ?? undefined}
          badge={
            <Badge variant={reorderVariant[r.reorder_status] ?? "warning"}>
              {reorderLabel[r.reorder_status] ?? r.reorder_status}
            </Badge>
          }
          fields={[
            {
              label: "Disponible",
              value: Math.round(r.available_qty),
            },
            {
              label: "Días stock",
              value:
                r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
              className:
                r.days_of_stock != null && r.days_of_stock <= 14
                  ? "text-danger font-bold"
                  : "",
            },
            {
              label: "Vendido 90d",
              value: Math.round(r.qty_sold_90d),
            },
            {
              label: "Daily rate",
              value:
                r.daily_run_rate != null
                  ? r.daily_run_rate.toFixed(1)
                  : "—",
            },
          ]}
        />
      )}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top movers
// ──────────────────────────────────────────────────────────────────────────
const topMoverColumns: DataTableColumn<TopMoverRow>[] = [
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
    key: "qty_90d",
    header: "Vendido 90d",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        {formatNumber(Math.round(r.qty_sold_90d))}
      </span>
    ),
    align: "right",
  },
  {
    key: "customers",
    header: "Clientes",
    cell: (r) => r.customers_12m,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "days_stock",
    header: "Días stock",
    cell: (r) =>
      r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
    align: "right",
  },
];

async function TopMoversTable() {
  const rows = await getTopMovers(15);
  return (
    <DataTable
      data={rows}
      columns={topMoverColumns}
      rowKey={(r, i) => `${r.product_ref ?? "tm"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          fields={[
            { label: "90d", value: formatNumber(Math.round(r.qty_sold_90d)) },
            { label: "Clientes", value: r.customers_12m },
            {
              label: "Días stock",
              value:
                r.days_of_stock != null ? Math.round(r.days_of_stock) : "—",
            },
            {
              label: "Stock $",
              value: <Currency amount={r.stock_value} compact />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Activity,
        title: "Sin top movers",
        description: "No hay productos con ventas recientes.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Top margin
// ──────────────────────────────────────────────────────────────────────────
const topMarginColumns: DataTableColumn<TopMarginProductRow>[] = [
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
    key: "revenue",
    header: "Revenue",
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "margin",
    header: "% Margen",
    cell: (r) => (
      <span
        className={
          r.weighted_margin_pct >= 50
            ? "text-success font-semibold"
            : r.weighted_margin_pct >= 25
              ? "text-warning"
              : "text-danger"
        }
      >
        {r.weighted_margin_pct.toFixed(1)}%
      </span>
    ),
    align: "right",
  },
  {
    key: "customers",
    header: "Clientes",
    cell: (r) => r.customers,
    align: "right",
    hideOnMobile: true,
  },
];

async function TopMarginTable() {
  const rows = await getTopMarginProducts(15);
  return (
    <DataTable
      data={rows}
      columns={topMarginColumns}
      rowKey={(r, i) => `${r.product_ref ?? "m"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          badge={
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                r.weighted_margin_pct >= 50
                  ? "bg-success/15 text-success-foreground"
                  : r.weighted_margin_pct >= 25
                    ? "bg-warning/15 text-warning-foreground"
                    : "bg-danger/15 text-danger-foreground"
              }`}
            >
              {r.weighted_margin_pct.toFixed(1)}%
            </span>
          }
          fields={[
            {
              label: "Revenue",
              value: <Currency amount={r.total_revenue} compact />,
            },
            { label: "Clientes", value: r.customers },
          ]}
        />
      )}
      emptyState={{
        icon: TrendingUp,
        title: "Sin datos de margen",
        description: "No hay datos en product_margin_analysis.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dead stock
// ──────────────────────────────────────────────────────────────────────────
const deadStockColumns: DataTableColumn<DeadStockRow>[] = [
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
    key: "days",
    header: "Días sin venta",
    cell: (r) => (
      <span className="font-semibold tabular-nums text-warning-foreground">
        {r.days_since_last_sale}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "value",
    header: "Valor",
    cell: (r) => <Currency amount={r.inventory_value} compact />,
    align: "right",
  },
  {
    key: "lifetime",
    header: "Revenue histórico",
    cell: (r) => <Currency amount={r.lifetime_revenue} compact />,
    align: "right",
    hideOnMobile: true,
  },
];

async function DeadStockTable() {
  const rows = await getDeadStock(20);
  return (
    <DataTable
      data={rows}
      columns={deadStockColumns}
      rowKey={(r, i) => `${r.product_ref ?? "d"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          badge={
            <span className="rounded bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
              <Currency amount={r.inventory_value} compact />
            </span>
          }
          fields={[
            { label: "Días sin venta", value: r.days_since_last_sale },
            {
              label: "Stock",
              value: Math.round(r.stock_qty),
            },
            {
              label: "Última venta",
              value: <DateDisplay date={r.last_sale_date} relative />,
            },
            {
              label: "Revenue total",
              value: <Currency amount={r.lifetime_revenue} compact />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Archive,
        title: "Sin stock muerto",
        description: "Todos los productos tienen movimiento reciente.",
      }}
    />
  );
}
