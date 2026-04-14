import { Suspense } from "react";
import {
  AlertTriangle,
  Beaker,
  Info,
  Layers,
  PackageSearch,
  ShieldAlert,
} from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  DataTable,
  MobileCard,
  Currency,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getBomCostSummary,
  getSuspiciousBoms,
  getBomsMissingComponents,
  getTopRevenueBoms,
  type BomCostRow,
  type BomCostSummary,
} from "@/lib/queries/products";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costos de BOM" };

function formatPct(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(0)}%`;
}

const suspiciousColumns: DataTableColumn<BomCostRow>[] = [
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
    key: "components",
    header: "Comp.",
    cell: (r) => (
      <span className="text-xs tabular-nums">{r.component_count}</span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "cached",
    header: "Std actual",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <Currency amount={r.cached_standard_price} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "real",
    header: "BOM costo",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.real_unit_cost} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "delta",
    header: "Δ%",
    cell: (r) => (
      <span className="font-bold tabular-nums text-danger">
        {formatPct(r.delta_vs_cached_pct)}
      </span>
    ),
    align: "right",
  },
  {
    key: "revenue",
    header: "Revenue 12m",
    cell: (r) => (
      <span className="text-xs tabular-nums">
        <Currency amount={r.revenue_12m} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
];

const missingColumns: DataTableColumn<BomCostRow>[] = [
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
    key: "missing",
    header: "Comp. sin costo",
    cell: (r) => (
      <Badge variant="warning" className="text-[10px]">
        {r.missing_cost_components} / {r.component_count}
      </Badge>
    ),
    align: "right",
  },
  {
    key: "partial",
    header: "Costo parcial",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <Currency amount={r.real_unit_cost} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "revenue",
    header: "Revenue 12m",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.revenue_12m} compact />
      </span>
    ),
    align: "right",
  },
];

const topRevenueColumns: DataTableColumn<BomCostRow>[] = [
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
    key: "revenue",
    header: "Revenue 12m",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.revenue_12m} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "price",
    header: "Precio venta",
    cell: (r) => (
      <span className="text-xs tabular-nums">
        <Currency amount={r.avg_order_price} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "cached",
    header: "Std actual",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <Currency amount={r.cached_standard_price} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "real",
    header: "BOM costo",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.real_unit_cost} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "delta",
    header: "Δ%",
    cell: (r) => {
      const d = r.delta_vs_cached_pct ?? 0;
      const cls =
        d > 50
          ? "text-danger font-bold"
          : d > 0
            ? "text-warning font-semibold"
            : d < -30
              ? "text-info"
              : "text-muted-foreground";
      return <span className={`text-xs tabular-nums ${cls}`}>{formatPct(d)}</span>;
    },
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "flags",
    header: "Flags",
    cell: (r) => {
      const flags: string[] = [];
      if (r.has_missing_costs)
        flags.push(`${r.missing_cost_components} sin costo`);
      if ((r.delta_vs_cached_pct ?? 0) > 50) flags.push("sospechoso");
      return (
        <span className="text-[10px] text-muted-foreground">
          {flags.length > 0 ? flags.join(" · ") : "—"}
        </span>
      );
    },
    hideOnMobile: true,
  },
];

export default function CostosBomPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Costos reales de BOM"
        subtitle="real_unit_cost derivado de BOMs activos — materia prima sumada por ingrediente"
      />

      {/* Disclaimer importante */}
      <Card className="border-info/40 bg-info/5">
        <CardContent className="flex items-start gap-3 pt-4">
          <Info className="h-5 w-5 shrink-0 text-info" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-foreground">
              Contexto importante
            </p>
            <p className="text-muted-foreground">
              Desde el <strong>1-Abr-2026</strong>, los BOMs se vaciaron de{" "}
              <strong>mano de obra</strong> y <strong>energéticos</strong>.
              Estos costos se incorporarán posteriormente vía{" "}
              <strong>centros de trabajo</strong>. Por eso el{" "}
              <code>BOM costo</code> aquí es <strong>sólo materia prima</strong>
              : es un límite inferior del costo total real.
            </p>
            <p className="text-muted-foreground">
              Consecuencia: un delta negativo vs <code>standard actual</code>{" "}
              NO es "descubrimiento de margen", es simplemente la porción de
              MO+energéticos aún no capturada. Un delta{" "}
              <span className="font-semibold text-danger">positivo</span> (BOM
              &gt; standard) sí es anomalía: probablemente BOM mal capturado.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <BomKpis />
      </Suspense>

      {/* BOMs sospechosos */}
      <Card className="border-danger/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-danger" />
            BOMs sospechosos (para revisar con Producción)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Productos donde el costo sólo-materia-prima ya excede al standard
            histórico por más de 50%. Con MO/energéticos removidos, esto NO
            debería pasar — casi siempre es captura errónea (cantidades, UoM, o
            componente equivocado).
          </p>
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
            <SuspiciousTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Componentes faltantes */}
      <Card className="border-warning/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            BOMs con componentes sin costear
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Productos donde al menos un componente del BOM no tiene{" "}
            <code>standard_price</code> en Odoo. Hasta que alguien les asigne
            costo, el <code>real_unit_cost</code> está subestimado. Ordenado
            por revenue 12m descendente.
          </p>
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
            <MissingTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Top revenue con BOM */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Top productos vendidos con BOM
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Los 30 productos con mayor revenue que tienen BOM activo. Son los
            primeros candidatos para revisar cuando los centros de trabajo
            estén configurados — cualquier imprecisión aquí mueve P&L.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <TopRevenueTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function BomKpis() {
  const s: BomCostSummary = await getBomCostSummary();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="BOMs activos"
        value={s.totalBoms}
        subtitle={`${s.productsWithRealCost} con costo real`}
        icon={Beaker}
      />
      <KpiCard
        title="Cobertura de ventas"
        value={`${s.coverageOfSalesPct.toFixed(0)}%`}
        subtitle={`de productos vendidos tienen BOM`}
        icon={Layers}
        tone={s.coverageOfSalesPct >= 70 ? "success" : "warning"}
      />
      <KpiCard
        title="BOMs sospechosos"
        value={s.suspiciousBomsCount}
        subtitle="Δ &gt; +50% (revisar)"
        icon={ShieldAlert}
        tone={s.suspiciousBomsCount > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Componentes sin costear"
        value={s.productsWithMissingComponents}
        subtitle="BOMs con gaps"
        icon={PackageSearch}
        tone={s.productsWithMissingComponents > 0 ? "warning" : "success"}
      />
    </StatGrid>
  );
}

async function SuspiciousTable() {
  const rows = await getSuspiciousBoms(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Sin BOMs sospechosos"
        description="Ningún BOM supera al standard histórico por más de 50%."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={suspiciousColumns}
      rowKey={(r) => `${r.odoo_product_id}`}
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
          badge={
            <Badge variant="critical" className="text-[10px] uppercase">
              {formatPct(r.delta_vs_cached_pct)}
            </Badge>
          }
          fields={[
            {
              label: "Std actual",
              value: <Currency amount={r.cached_standard_price} compact />,
            },
            {
              label: "BOM costo",
              value: <Currency amount={r.real_unit_cost} compact />,
              className: "text-danger font-semibold",
            },
            {
              label: "Componentes",
              value: String(r.component_count),
            },
            {
              label: "Revenue 12m",
              value: <Currency amount={r.revenue_12m} compact />,
            },
          ]}
        />
      )}
    />
  );
}

async function MissingTable() {
  const rows = await getBomsMissingComponents(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Sin BOMs con componentes incompletos"
        description="Todos los componentes tienen standard_price asignado."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={missingColumns}
      rowKey={(r) => `${r.odoo_product_id}`}
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
          badge={
            <Badge variant="warning" className="text-[10px] uppercase">
              {r.missing_cost_components}/{r.component_count} sin costo
            </Badge>
          }
          fields={[
            {
              label: "Costo parcial",
              value: <Currency amount={r.real_unit_cost} compact />,
            },
            {
              label: "Revenue 12m",
              value: <Currency amount={r.revenue_12m} compact />,
              className: "font-semibold",
            },
          ]}
        />
      )}
    />
  );
}

async function TopRevenueTable() {
  const rows = await getTopRevenueBoms(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Sin overlap entre ventas y BOMs"
        description="Ningún producto vendido tiene BOM activo todavía."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={topRevenueColumns}
      rowKey={(r) => `${r.odoo_product_id}`}
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
          badge={
            r.has_missing_costs ? (
              <Badge variant="warning" className="text-[10px] uppercase">
                gaps
              </Badge>
            ) : (r.delta_vs_cached_pct ?? 0) > 50 ? (
              <Badge variant="critical" className="text-[10px] uppercase">
                sospechoso
              </Badge>
            ) : undefined
          }
          fields={[
            {
              label: "Revenue 12m",
              value: <Currency amount={r.revenue_12m} compact />,
              className: "font-semibold",
            },
            {
              label: "Precio avg",
              value: <Currency amount={r.avg_order_price} compact />,
            },
            {
              label: "Std actual",
              value: <Currency amount={r.cached_standard_price} compact />,
            },
            {
              label: "BOM costo",
              value: <Currency amount={r.real_unit_cost} compact />,
              className: "font-semibold",
            },
            {
              label: "Δ%",
              value: formatPct(r.delta_vs_cached_pct),
            },
          ]}
        />
      )}
    />
  );
}
