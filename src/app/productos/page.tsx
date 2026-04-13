import { Suspense } from "react";
import { AlertTriangle, Archive, Package, PackageX } from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  Currency,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDeadStock,
  getProducts,
  getProductsKpis,
  type DeadStockRow,
  type ProductRow,
} from "@/lib/queries/products";

export const dynamic = "force-dynamic";
export const metadata = { title: "Productos" };

export default function ProductosPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Productos"
        subtitle="Catálogo, stock y productos sin movimiento"
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
        <ProductsKpisSection />
      </Suspense>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Top stock</h2>
          <Suspense fallback={<Skeleton className="h-[360px] rounded-xl" />}>
            <ProductsTable />
          </Suspense>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Stock muerto</h2>
          <Suspense fallback={<Skeleton className="h-[360px] rounded-xl" />}>
            <DeadStockTable />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function ProductsKpisSection() {
  const k = await getProductsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard title="Catálogo" value={k.catalogCount} icon={Package} format="number" />
      <KpiCard
        title="Sin stock"
        value={k.outOfStockCount}
        icon={PackageX}
        format="number"
        tone={k.outOfStockCount > 0 ? "danger" : "default"}
      />
      <KpiCard
        title="Stock muerto"
        value={k.deadStockValue}
        icon={Archive}
        format="currency"
        compact
        tone="warning"
      />
      <KpiCard
        title="Por reordenar"
        value={k.reorderCount}
        icon={AlertTriangle}
        format="number"
        tone={k.reorderCount > 0 ? "warning" : "default"}
      />
    </StatGrid>
  );
}

const productColumns: DataTableColumn<ProductRow>[] = [
  {
    key: "ref",
    header: "Ref",
    cell: (r) => <span className="font-mono text-xs">{r.internal_ref ?? "—"}</span>,
  },
  {
    key: "name",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.name ?? "—"}</span>,
  },
  {
    key: "stock",
    header: "Stock",
    cell: (r) => <span className="tabular-nums">{r.stock_qty ?? 0}</span>,
    align: "right",
  },
  {
    key: "available",
    header: "Disponible",
    cell: (r) => <span className="tabular-nums">{r.available_qty ?? 0}</span>,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "price",
    header: "Precio",
    cell: (r) => <Currency amount={r.list_price} />,
    align: "right",
    hideOnMobile: true,
  },
];

async function ProductsTable() {
  const rows = await getProducts(30);
  return (
    <DataTable
      data={rows}
      columns={productColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? r.internal_ref ?? "—"}
          subtitle={r.internal_ref ?? undefined}
          fields={[
            { label: "Stock", value: r.stock_qty ?? 0 },
            { label: "Disponible", value: r.available_qty ?? 0 },
            { label: "Precio", value: <Currency amount={r.list_price} /> },
          ]}
        />
      )}
      emptyState={{
        icon: Package,
        title: "Sin productos",
        description: "No hay productos en el catálogo.",
      }}
    />
  );
}

const deadStockColumns: DataTableColumn<DeadStockRow>[] = [
  {
    key: "ref",
    header: "Ref",
    cell: (r) => <span className="font-mono text-xs">{r.product_ref ?? "—"}</span>,
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
      <span className="tabular-nums text-warning-foreground">
        {r.days_since_last_sale ?? 0}
      </span>
    ),
    align: "right",
  },
  {
    key: "value",
    header: "Valor",
    cell: (r) => <Currency amount={r.inventory_value} compact />,
    align: "right",
  },
];

async function DeadStockTable() {
  const rows = await getDeadStock(20);
  return (
    <DataTable
      data={rows}
      columns={deadStockColumns}
      rowKey={(r) => r.product_ref ?? Math.random().toString(36)}
      mobileCard={(r) => (
        <MobileCard
          title={r.product_name ?? r.product_ref ?? "—"}
          subtitle={r.product_ref ?? undefined}
          fields={[
            { label: "Días sin venta", value: r.days_since_last_sale ?? 0 },
            {
              label: "Valor",
              value: <Currency amount={r.inventory_value} compact />,
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
