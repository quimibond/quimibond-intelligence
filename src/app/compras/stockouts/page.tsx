import { Suspense } from "react";
import { AlertTriangle, Package, ShoppingCart, Truck } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStockoutQueue,
  getStockoutSummary,
  type StockoutRow,
  type StockoutUrgency,
} from "@/lib/queries/analytics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cola de reposición" };

const urgencyVariant: Record<
  StockoutUrgency,
  "critical" | "warning" | "info" | "secondary"
> = {
  STOCKOUT: "critical",
  CRITICAL: "critical",
  URGENT: "warning",
  ATTENTION: "info",
  OK: "secondary",
};

const urgencyLabel: Record<StockoutUrgency, string> = {
  STOCKOUT: "Sin stock",
  CRITICAL: "Crítico",
  URGENT: "Urgente",
  ATTENTION: "Vigilar",
  OK: "OK",
};

function formatMxnCompact(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M MXN`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K MXN`;
  return `${Math.round(amount)} MXN`;
}

function formatQty(qty: number): string {
  if (qty >= 10000) return `${(qty / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(qty);
}

const columns: DataTableColumn<StockoutRow>[] = [
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
    key: "urgency",
    header: "Urgencia",
    cell: (r) => (
      <Badge variant={urgencyVariant[r.urgency]} className="text-[10px] uppercase">
        {urgencyLabel[r.urgency]}
      </Badge>
    ),
  },
  {
    key: "days",
    header: "Días",
    cell: (r) =>
      r.days_of_stock != null ? (
        <span
          className={
            r.days_of_stock <= 0
              ? "font-bold text-danger"
              : r.days_of_stock < 7
                ? "font-semibold text-danger"
                : r.days_of_stock < 15
                  ? "font-semibold text-warning"
                  : "tabular-nums"
          }
        >
          {r.days_of_stock}d
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
  },
  {
    key: "stock",
    header: "Stock",
    cell: (r) => (
      <span className="tabular-nums">{formatQty(r.stock_qty)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "rate",
    header: "/ día",
    cell: (r) => (
      <span className="tabular-nums">{formatQty(r.daily_run_rate)}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "suggested",
    header: "Sugerido",
    cell: (r) =>
      r.suggested_order_qty > 0 ? (
        <span className="font-semibold tabular-nums text-info">
          {formatQty(r.suggested_order_qty)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
  },
  {
    key: "on_order",
    header: "Pedido",
    cell: (r) =>
      r.qty_on_order > 0 ? (
        <span className="tabular-nums text-success">
          {formatQty(r.qty_on_order)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "supplier",
    header: "Último proveedor",
    cell: (r) =>
      r.last_supplier_name ? (
        <span className="truncate text-xs">{r.last_supplier_name}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "risk",
    header: "Revenue 30d en riesgo",
    cell: (r) => <Currency amount={r.revenue_at_risk_30d_mxn} compact />,
    align: "right",
    hideOnMobile: true,
  },
];

export default function StockoutQueuePage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Compras", href: "/compras" },
          { label: "Cola de reposición" },
        ]}
        title="Cola de reposición"
        subtitle="Productos en riesgo de faltante con orden sugerida y proveedor"
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
        <StockoutKpis />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        }
      >
        <StockoutTable />
      </Suspense>
    </div>
  );
}

async function StockoutKpis() {
  const summary = await getStockoutSummary();
  const get = (u: StockoutUrgency) =>
    summary.find((s) => s.urgency === u) ?? {
      count: 0,
      revenue_at_risk: 0,
      urgency: u,
    };
  const stockout = get("STOCKOUT");
  const critical = get("CRITICAL");
  const urgent = get("URGENT");
  const totalAtRisk =
    stockout.revenue_at_risk + critical.revenue_at_risk + urgent.revenue_at_risk;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Sin stock"
        value={stockout.count}
        subtitle={`${formatMxnCompact(stockout.revenue_at_risk)} en riesgo`}
        icon={AlertTriangle}
        tone="danger"
      />
      <KpiCard
        title="Crítico (<7d)"
        value={critical.count}
        subtitle={`${formatMxnCompact(critical.revenue_at_risk)} en riesgo`}
        icon={Package}
        tone="danger"
      />
      <KpiCard
        title="Urgente (<15d)"
        value={urgent.count}
        subtitle={`${formatMxnCompact(urgent.revenue_at_risk)} en riesgo`}
        icon={Truck}
        tone="warning"
      />
      <KpiCard
        title="Total revenue 30d"
        value={totalAtRisk}
        format="currency"
        compact
        subtitle="en riesgo si no se repone"
        icon={ShoppingCart}
        tone="info"
      />
    </StatGrid>
  );
}

async function StockoutTable() {
  const rows = await getStockoutQueue(undefined, 100);
  const actionable = rows.filter((r) => r.urgency !== "OK");

  if (actionable.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin riesgos de faltante"
        description="Todos los productos tienen stock suficiente para los próximos 30 días."
      />
    );
  }

  return (
    <DataTable
      data={actionable}
      columns={columns}
      rowKey={(r) => String(r.odoo_product_id)}
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
          subtitle={r.last_supplier_name ?? undefined}
          badge={
            <Badge
              variant={urgencyVariant[r.urgency]}
              className="text-[10px] uppercase"
            >
              {urgencyLabel[r.urgency]}
            </Badge>
          }
          fields={[
            {
              label: "Días stock",
              value:
                r.days_of_stock != null ? `${r.days_of_stock}d` : "—",
              className:
                r.days_of_stock != null && r.days_of_stock < 15
                  ? "text-danger font-semibold"
                  : undefined,
            },
            {
              label: "Stock actual",
              value: formatQty(r.stock_qty),
            },
            {
              label: "Vende / día",
              value: formatQty(r.daily_run_rate),
            },
            {
              label: "Sugerido",
              value:
                r.suggested_order_qty > 0
                  ? formatQty(r.suggested_order_qty)
                  : "—",
              className: "text-info font-semibold",
            },
            {
              label: "Top consumer",
              value: r.top_consumer ?? "—",
              className: "col-span-2 text-[10px] truncate",
            },
          ]}
        />
      )}
    />
  );
}
