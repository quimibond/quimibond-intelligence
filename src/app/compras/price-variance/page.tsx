import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  DataTable,
  MobileCard,
  Currency,
  DateDisplay,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSupplierPriceAlerts,
  type PriceFlag,
  type SupplierPriceRow,
} from "@/lib/queries/analytics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Variancia de precios" };

const flagVariant: Record<
  PriceFlag,
  "critical" | "warning" | "info" | "success" | "secondary"
> = {
  overpriced: "critical",
  above_market: "warning",
  aligned: "info",
  below_market: "success",
  single_source: "secondary",
};

const flagLabel: Record<PriceFlag, string> = {
  overpriced: "Sobreprecio",
  above_market: "Encima",
  aligned: "Alineado",
  below_market: "Debajo",
  single_source: "Único",
};

function formatCohortMonth(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

function formatPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(0)}%`;
}

const overpaidColumns: DataTableColumn<SupplierPriceRow>[] = [
  {
    key: "month",
    header: "Mes",
    cell: (r) => (
      <span className="font-mono text-[10px] uppercase tabular-nums text-muted-foreground">
        {formatCohortMonth(r.month)}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold">
          {r.product_ref ?? "—"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {r.product_name ?? ""}
        </div>
      </div>
    ),
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) => <span className="truncate text-xs">{r.supplier_name}</span>,
  },
  {
    key: "flag",
    header: "Flag",
    cell: (r) => (
      <Badge variant={flagVariant[r.price_flag]} className="text-[10px] uppercase">
        {flagLabel[r.price_flag]}
      </Badge>
    ),
  },
  {
    key: "index",
    header: "Índice",
    cell: (r) => (
      <span
        className={
          r.price_index >= 130
            ? "font-bold tabular-nums text-danger"
            : r.price_index >= 110
              ? "font-semibold tabular-nums text-warning"
              : "tabular-nums"
        }
      >
        {r.price_index.toFixed(0)}
      </span>
    ),
    align: "right",
  },
  {
    key: "delta",
    header: "Δ vs benchmark",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatPct(((r.supplier_avg_price - r.benchmark_price) / Math.max(r.benchmark_price, 1)) * 100)}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "qty",
    header: "Qty comprada",
    cell: (r) => (
      <span className="tabular-nums">
        {new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(
          r.supplier_qty
        )}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "overpaid",
    header: "$ desperdiciado",
    cell: (r) => (
      <span className="font-semibold text-danger">
        <Currency amount={r.overpaid_mxn} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "po",
    header: "Última PO",
    cell: (r) => (
      <span className="font-mono text-[11px]">
        {r.last_po_name ?? "—"}
      </span>
    ),
    hideOnMobile: true,
  },
];

const savedColumns: DataTableColumn<SupplierPriceRow>[] = [
  {
    key: "month",
    header: "Mes",
    cell: (r) => (
      <span className="font-mono text-[10px] uppercase tabular-nums text-muted-foreground">
        {formatCohortMonth(r.month)}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold">
          {r.product_ref ?? "—"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {r.product_name ?? ""}
        </div>
      </div>
    ),
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) => <span className="truncate text-xs">{r.supplier_name}</span>,
  },
  {
    key: "index",
    header: "Índice",
    cell: (r) => (
      <span className="font-semibold tabular-nums text-success">
        {r.price_index.toFixed(0)}
      </span>
    ),
    align: "right",
  },
  {
    key: "saved",
    header: "$ ahorrado",
    cell: (r) => (
      <span className="font-semibold text-success">
        <Currency amount={r.saved_mxn} compact />
      </span>
    ),
    align: "right",
  },
];

export default function PriceVariancePage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Variancia de precios de compra"
        subtitle="Proveedores con precios ≠ al benchmark del mercado (mismo producto, mismo mes)"
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
        <PriceVarianceKpis />
      </Suspense>

      {/* Sobreprecio + above_market */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Compras con sobreprecio
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Líneas pagadas por encima del benchmark del mes. Cada fila es un
            (producto × proveedor × mes). Renegociables.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <OverpricedTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Below market — el lado bueno */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Proveedores con buen precio
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Compras debajo del benchmark del mes. Estos proveedores son
            candidatos para más volumen.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <SavedTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function PriceVarianceKpis() {
  const [overpriced, aboveMarket, belowMarket] = await Promise.all([
    getSupplierPriceAlerts("overpriced", 6, 200),
    getSupplierPriceAlerts("above_market", 6, 200),
    getSupplierPriceAlerts("below_market", 6, 200),
  ]);

  const totalOverpaid =
    overpriced.reduce((a, r) => a + r.overpaid_mxn, 0) +
    aboveMarket.reduce((a, r) => a + r.overpaid_mxn, 0);
  const totalSaved = belowMarket.reduce((a, r) => a + r.saved_mxn, 0);
  const overpricedCount = overpriced.length + aboveMarket.length;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Sobreprecio"
        value={overpriced.length}
        subtitle={`>30% sobre benchmark`}
        icon={ShieldAlert}
        tone="danger"
      />
      <KpiCard
        title="Encima de mercado"
        value={aboveMarket.length}
        subtitle={`>10% sobre benchmark`}
        icon={ArrowUpCircle}
        tone="warning"
      />
      <KpiCard
        title="$ desperdiciado 6m"
        value={totalOverpaid}
        format="currency"
        compact
        subtitle={`${overpricedCount} líneas`}
        icon={Banknote}
        tone="danger"
      />
      <KpiCard
        title="$ ahorrado 6m"
        value={totalSaved}
        format="currency"
        compact
        subtitle={`${belowMarket.length} líneas debajo`}
        icon={ArrowDownCircle}
        tone="success"
      />
    </StatGrid>
  );
}

async function OverpricedTable() {
  const [overpriced, aboveMarket] = await Promise.all([
    getSupplierPriceAlerts("overpriced", 6, 100),
    getSupplierPriceAlerts("above_market", 6, 100),
  ]);
  const all = [...overpriced, ...aboveMarket].sort(
    (a, b) => b.overpaid_mxn - a.overpaid_mxn
  );

  if (all.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin sobreprecios detectados"
        description="Todos los proveedores están alineados al benchmark."
      />
    );
  }

  return (
    <DataTable
      data={all}
      columns={overpaidColumns}
      rowKey={(r) => `${r.odoo_product_id}-${r.supplier_id}-${r.month}`}
      mobileCard={(r) => (
        <MobileCard
          title={
            <div>
              <div className="font-mono text-xs font-bold">
                {r.product_ref ?? "—"}
              </div>
              <div className="truncate text-[11px] font-normal text-muted-foreground">
                {r.product_name ?? ""}
              </div>
            </div>
          }
          subtitle={r.supplier_name}
          badge={
            <Badge
              variant={flagVariant[r.price_flag]}
              className="text-[10px] uppercase"
            >
              {flagLabel[r.price_flag]}
            </Badge>
          }
          fields={[
            {
              label: "Índice",
              value: (
                <span
                  className={
                    r.price_index >= 130
                      ? "text-danger font-bold"
                      : "text-warning font-semibold"
                  }
                >
                  {r.price_index.toFixed(0)}
                </span>
              ),
            },
            {
              label: "$ perdido",
              value: <Currency amount={r.overpaid_mxn} compact />,
              className: "text-danger font-semibold",
            },
            {
              label: "Mes",
              value: formatCohortMonth(r.month),
            },
            {
              label: "Última PO",
              value: r.last_po_name ?? "—",
              className: "font-mono text-[10px]",
            },
          ]}
        />
      )}
    />
  );
}

async function SavedTable() {
  const rows = await getSupplierPriceAlerts("below_market", 6, 30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ArrowDownCircle}
        title="Sin proveedores debajo del benchmark"
        description="Ningún proveedor cobró menos del promedio del mercado."
        compact
      />
    );
  }

  return (
    <DataTable
      data={rows.sort((a, b) => b.saved_mxn - a.saved_mxn)}
      columns={savedColumns}
      rowKey={(r) => `${r.odoo_product_id}-${r.supplier_id}-${r.month}`}
      mobileCard={(r) => (
        <MobileCard
          title={
            <div>
              <div className="font-mono text-xs font-bold">
                {r.product_ref ?? "—"}
              </div>
              <div className="truncate text-[11px] font-normal text-muted-foreground">
                {r.product_name ?? ""}
              </div>
            </div>
          }
          subtitle={r.supplier_name}
          badge={
            <Badge variant="success" className="text-[10px] uppercase">
              Debajo
            </Badge>
          }
          fields={[
            {
              label: "Índice",
              value: (
                <span className="text-success font-semibold">
                  {r.price_index.toFixed(0)}
                </span>
              ),
            },
            {
              label: "$ ahorrado",
              value: <Currency amount={r.saved_mxn} compact />,
              className: "text-success font-semibold",
            },
          ]}
        />
      )}
    />
  );
}
