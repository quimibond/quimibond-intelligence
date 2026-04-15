import { Suspense } from "react";
import {
  AlertTriangle,
  Beaker,
  Copy,
  GitBranch,
  Info,
  Layers,
  PackageSearch,
  Scale,
  ShieldAlert,
} from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  DataTable,
  TableExportButton,
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
  getBomsWithMultipleVersions,
  getBomDuplicates,
  getUomMismatchProducts,
  type BomCostRow,
  type BomCostSummary,
  type BomDuplicateRow,
  type UomMismatchRow,
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
    header: "MP",
    cell: (r) => (
      <div className="text-right text-[10px] tabular-nums leading-tight">
        <div>{r.distinct_raw_components} raw</div>
        <div className="text-muted-foreground">d{r.max_depth}</div>
      </div>
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
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Compras", href: "/compras" },
          { label: "Costos de BOM" },
        ]}
        title="Costos reales de BOM"
        subtitle="real_unit_cost derivado de BOMs activos — materia prima sumada por ingrediente"
      />

      {/* Disclaimer importante */}
      <Card className="border-info/40 bg-info/5">
        <CardContent className="flex items-start gap-3 pt-4">
          <Info className="h-5 w-5 shrink-0 text-info" />
          <div className="space-y-2 text-xs">
            <p className="font-semibold text-foreground">
              Cómo se calcula el BOM costo
            </p>
            <p className="text-muted-foreground">
              <strong>Rolldown recursivo</strong>: para cada producto vendido,
              bajamos por todo el árbol de BOMs hasta llegar a las hojas
              (productos sin BOM activo = materia prima pura) y sumamos{" "}
              <code>cantidad × standard_price</code>. Profundidad máxima
              observada: <strong>9 niveles</strong>. Multi-BOMs: usamos el más
              reciente (<code>MAX(odoo_bom_id)</code>). Ciclos: cortados al
              detectar repetición.
            </p>
            <p className="text-muted-foreground">
              <strong>Importante</strong>: desde el <strong>1-Abr-2026</strong>,
              los BOMs no contienen <strong>mano de obra</strong> ni{" "}
              <strong>energéticos</strong>. Se incorporarán posteriormente vía{" "}
              <strong>centros de trabajo</strong>. Por eso el BOM costo es sólo
              materia prima — un límite inferior del costo total. Un delta
              negativo vs standard NO es margen descubierto.
            </p>
            <p className="text-muted-foreground">
              Un delta{" "}
              <span className="font-semibold text-danger">positivo</span> (BOM
              &gt; standard) sí es anomalía: probablemente BOM mal capturado.
              Ver tabla "BOMs sospechosos".
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
      <Card className="border-danger/40" data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-danger" />
              BOMs sospechosos (para revisar con Producción)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos donde el costo sólo-materia-prima ya excede al standard
              histórico por más de 50%. Con MO/energéticos removidos, esto NO
              debería pasar — casi siempre es captura errónea (cantidades, UoM,
              o componente equivocado).
            </p>
          </div>
          <TableExportButton filename="bom-suspicious" />
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
      <Card className="border-warning/40" data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
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
          </div>
          <TableExportButton filename="bom-missing-components" />
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
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              Top productos vendidos con BOM
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Los 30 productos con mayor revenue que tienen BOM activo. Son los
              primeros candidatos para revisar cuando los centros de trabajo
              estén configurados — cualquier imprecisión aquí mueve P&L.
            </p>
          </div>
          <TableExportButton filename="bom-top-revenue" />
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

      {/* UoM mismatch en líneas de venta */}
      <Card className="border-warning/40" data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-warning" />
              Productos con UoM inconsistente en ventas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos donde alguna línea de venta o factura usa una unidad de
              medida <strong>diferente</strong> a la unidad canónica del
              producto (ej. tela marcada en metros pero vendida por kilos).
              Mi PMA excluye esas líneas del cálculo de qty/precio promedio
              para no mezclar metros con kilos. <strong>Acción</strong>:
              Producción debe decidir si vender por m o kg y consolidar el UoM
              del producto en Odoo.
            </p>
          </div>
          <TableExportButton filename="bom-uom-mismatch" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <UomMismatchTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Componentes duplicados dentro de BOMs */}
      <Card className="border-warning/40" data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Componentes duplicados dentro del BOM
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Detecta dos casos: (A) un mismo componente listado más de una
              vez en el mismo BOM, (B) dos componentes con el mismo{" "}
              <strong>nombre</strong> pero <code>odoo_product_id</code>{" "}
              diferente (ej. dos SKUs de "HILO POLIESTER ALGODON 22/1" creados
              para distintos batches o proveedores). Mi rolldown los suma a
              ambos → el costo BOM está sobrecontado por la diferencia.
              Producción debería consolidar uno solo. Detecta duplicados en
              cualquier nivel del árbol.
            </p>
          </div>
          <TableExportButton filename="bom-duplicates" />
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
            <DuplicatesTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* BOMs con múltiples versiones */}
      <Card className="border-info/40" data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Copy className="h-4 w-4 text-info" />
              BOMs con múltiples versiones activas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Productos con más de un BOM activo. El cálculo usa el más
              reciente (<code>MAX(odoo_bom_id)</code>) como fuente de verdad —
              pero los BOMs viejos siguen existiendo y pueden ser usados
              accidentalmente por Producción. Sugerido: desactivar los
              obsoletos en Odoo.
            </p>
          </div>
          <TableExportButton filename="bom-multi-versions" />
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
            <MultiBomTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function BomKpis() {
  const s: BomCostSummary = await getBomCostSummary();
  const medianText =
    s.medianDeltaCompletePct != null
      ? `${s.medianDeltaCompletePct > 0 ? "+" : ""}${s.medianDeltaCompletePct.toFixed(0)}% mediana (completos)`
      : "sin data";
  return (
    <>
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="BOMs activos"
          value={s.totalBoms}
          subtitle={`${s.productsWithRealCost} con costo recursivo`}
          icon={Beaker}
        />
        <KpiCard
          title="Profundidad máx"
          value={s.maxBomDepth}
          subtitle={`niveles del árbol BOM`}
          icon={Layers}
          tone={s.maxBomDepth >= 5 ? "info" : "default"}
        />
        <KpiCard
          title="BOMs sospechosos"
          value={s.suspiciousBomsCount}
          subtitle={medianText}
          icon={ShieldAlert}
          tone={s.suspiciousBomsCount > 0 ? "danger" : "success"}
        />
        <KpiCard
          title="MP raíz sin costo"
          value={s.productsWithMissingComponents}
          subtitle="BOMs con leaves sin standard_price"
          icon={PackageSearch}
          tone={s.productsWithMissingComponents > 0 ? "warning" : "success"}
        />
      </StatGrid>
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Cobertura ventas"
          value={`${s.coverageOfSalesPct.toFixed(0)}%`}
          subtitle={`${s.productsInSales} productos vendidos`}
          icon={Layers}
          tone={s.coverageOfSalesPct >= 70 ? "success" : "warning"}
        />
        <KpiCard
          title="Productos multi-BOM"
          value={s.productsWithMultipleBoms}
          subtitle="usando BOM más reciente"
          icon={Copy}
          tone={s.productsWithMultipleBoms > 0 ? "info" : "default"}
        />
        <KpiCard
          title="d1 / shallow"
          value={s.productsByDepth.find((d) => d.depth === 1)?.count ?? 0}
          subtitle="productos con BOM de 1 nivel"
          icon={GitBranch}
        />
        <KpiCard
          title="d4+ / deep"
          value={s.productsByDepth
            .filter((d) => d.depth >= 4)
            .reduce((a, d) => a + d.count, 0)}
          subtitle="productos con árbol profundo"
          icon={GitBranch}
        />
      </StatGrid>
    </>
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

const multiBomColumns: DataTableColumn<BomCostRow>[] = [
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
    key: "boms",
    header: "# BOMs",
    cell: (r) => (
      <Badge variant="info" className="text-[10px]">
        {r.active_boms_for_product}
      </Badge>
    ),
    align: "right",
  },
  {
    key: "depth",
    header: "Depth",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        d{r.max_depth}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "real",
    header: "BOM costo (más reciente)",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.real_unit_cost} compact />
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

const uomMismatchColumns: DataTableColumn<UomMismatchRow>[] = [
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
    key: "uom",
    header: "UoM canónica",
    cell: (r) => (
      <Badge variant="info" className="text-[10px]">
        {r.product_uom ?? "—"}
      </Badge>
    ),
    align: "center",
  },
  {
    key: "lines",
    header: "Líneas malas",
    cell: (r) => (
      <div className="text-right text-[11px] tabular-nums leading-tight">
        <div>{r.mismatch_order_lines} órdenes</div>
        <div className="text-muted-foreground">
          {r.mismatch_invoice_lines} facturas
        </div>
      </div>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "rev",
    header: "$ con UoM mala",
    cell: (r) => (
      <span className="font-semibold tabular-nums text-warning">
        <Currency amount={r.mismatch_revenue_mxn} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "total",
    header: "$ total prod",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <Currency amount={r.total_revenue_mxn} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
];

async function UomMismatchTable() {
  const rows = await getUomMismatchProducts(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Sin UoM inconsistentes"
        description="Todos los productos se venden en su unidad canónica."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={uomMismatchColumns}
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
              {r.mismatch_order_lines + r.mismatch_invoice_lines} bad
            </Badge>
          }
          fields={[
            { label: "UoM canónica", value: r.product_uom ?? "—" },
            {
              label: "Revenue malo",
              value: <Currency amount={r.mismatch_revenue_mxn} compact />,
              className: "text-warning font-semibold",
            },
            {
              label: "Revenue total",
              value: <Currency amount={r.total_revenue_mxn} compact />,
            },
          ]}
        />
      )}
    />
  );
}

const dupColumns: DataTableColumn<BomDuplicateRow>[] = [
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
    key: "kind",
    header: "Tipo",
    cell: (r) => (
      <div className="flex flex-wrap gap-1 text-[10px]">
        {r.intra_dupe_components > 0 && (
          <Badge variant="warning" className="text-[10px]">
            {r.intra_dupe_components} intra
          </Badge>
        )}
        {r.same_name_groups > 0 && (
          <Badge variant="critical" className="text-[10px]">
            {r.same_name_groups} same-name
          </Badge>
        )}
      </div>
    ),
    hideOnMobile: true,
  },
  {
    key: "real",
    header: "BOM costo",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <Currency amount={r.real_unit_cost} compact />
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "over",
    header: "Δ over/unit",
    cell: (r) => (
      <span className="font-bold tabular-nums text-warning">
        <Currency amount={r.total_overcounted_per_unit_mxn} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "pct",
    header: "% del costo",
    cell: (r) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {r.overcounted_pct_of_cost != null
          ? `${r.overcounted_pct_of_cost.toFixed(0)}%`
          : "—"}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "impact",
    header: "$ inflado 12m",
    cell: (r) => (
      <span className="font-semibold tabular-nums text-danger">
        <Currency amount={r.total_revenue_impact_mxn} compact />
      </span>
    ),
    align: "right",
  },
];

async function DuplicatesTable() {
  const rows = await getBomDuplicates(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin duplicados detectados"
        description="Ningún BOM tiene componentes duplicados."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={dupColumns}
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
              {r.intra_dupe_components + r.same_name_groups} dupes
            </Badge>
          }
          fields={[
            {
              label: "Costo BOM",
              value: <Currency amount={r.real_unit_cost} compact />,
            },
            {
              label: "Sobrecontado/unit",
              value: <Currency amount={r.total_overcounted_per_unit_mxn} compact />,
              className: "text-warning font-semibold",
            },
            {
              label: "$ inflado 12m",
              value: <Currency amount={r.total_revenue_impact_mxn} compact />,
              className: "text-danger font-semibold",
            },
          ]}
        />
      )}
    />
  );
}

async function MultiBomTable() {
  const rows = await getBomsWithMultipleVersions(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Copy}
        title="Sin productos multi-BOM"
        description="Cada producto tiene exactamente un BOM activo."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={multiBomColumns}
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
            <Badge variant="info" className="text-[10px]">
              {r.active_boms_for_product} BOMs
            </Badge>
          }
          fields={[
            { label: "Profundidad", value: `d${r.max_depth}` },
            {
              label: "BOM costo",
              value: <Currency amount={r.real_unit_cost} compact />,
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
