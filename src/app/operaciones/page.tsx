import { Suspense } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Factory,
  Package,
  Truck,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  CompanyLink,
  DateDisplay,
  StatusBadge,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

import {
  getOperationsKpis,
  getWeeklyTrend,
  getDeliveriesPage,
  getManufacturingPage,
  getManufacturingAssigneeOptions,
  type DeliveryRow,
  type ManufacturingRow,
} from "@/lib/queries/operations";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";

import { OtdWeeklyChart } from "./_components/otd-weekly-chart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operaciones" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OperacionesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Operaciones"
        subtitle="OTD semanal, entregas tarde, manufactura activa"
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
        <OpsHeroKpis />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            OTD semanal — últimas 12 semanas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-md" />}
          >
            <WeeklyChartSection />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Entregas</CardTitle>
            <p className="text-xs text-muted-foreground">
              Busca por número u origen. Filtra por estado, tipo de picking,
              fecha programada o solo tarde.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="dl_"
              columns={deliveryViewColumns}
            />
            <TableExportButton filename="deliveries" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="dl_"
            searchPlaceholder="Buscar entrega u origen…"
            dateRange={{ label: "Fecha programada" }}
            facets={[
              {
                key: "state",
                label: "Estado",
                options: [
                  { value: "draft", label: "Borrador" },
                  { value: "waiting", label: "Esperando" },
                  { value: "confirmed", label: "Confirmada" },
                  { value: "assigned", label: "Asignada" },
                  { value: "done", label: "Completada" },
                  { value: "cancel", label: "Cancelada" },
                ],
              },
              {
                key: "picking_type",
                label: "Tipo",
                options: [
                  { value: "outgoing", label: "Salida" },
                  { value: "incoming", label: "Entrada" },
                  { value: "internal", label: "Interno" },
                ],
              },
              {
                key: "late",
                label: "Atraso",
                multiple: false,
                options: [{ value: "1", label: "Solo tarde" }],
              },
            ]}
          />
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <DeliveriesTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Manufactura</CardTitle>
            <p className="text-xs text-muted-foreground">
              Filtra por estado, responsable o fecha. Busca por número de
              orden, producto u origen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="mfg_"
              columns={manufacturingViewColumns}
            />
            <TableExportButton filename="manufacturing" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={null}>
            <ManufacturingToolbar />
          </Suspense>
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <ManufacturingTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero KPIs
// ──────────────────────────────────────────────────────────────────────────
async function OpsHeroKpis() {
  const k = await getOperationsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="OTD última semana"
        value={k.otdLatestPct}
        format="percent"
        icon={Truck}
        subtitle={
          k.otdAvg4w != null
            ? `${k.otdAvg4w.toFixed(1)}% prom 4 sem`
            : undefined
        }
        tone={
          k.otdLatestPct == null
            ? "default"
            : k.otdLatestPct >= 90
              ? "success"
              : k.otdLatestPct >= 75
                ? "warning"
                : "danger"
        }
      />
      <KpiCard
        title="Entregas tarde"
        value={k.lateOpen}
        format="number"
        icon={AlertTriangle}
        subtitle="abiertas"
        tone={k.lateOpen > 0 ? "warning" : "success"}
      />
      <KpiCard
        title="Manufactura activa"
        value={k.mfgInProgress}
        format="number"
        icon={Factory}
        subtitle={
          k.mfgToClose > 0 ? `${k.mfgToClose} por cerrar` : undefined
        }
      />
      <KpiCard
        title="Lead time prom"
        value={k.avgLeadDays}
        format="days"
        icon={Clock}
        subtitle="4 semanas"
      />
    </StatGrid>
  );
}

async function WeeklyChartSection() {
  const data = await getWeeklyTrend(12);
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Truck}
        title="Sin datos OTD semanal"
        description="ops_delivery_health_weekly está vacío."
        compact
      />
    );
  }
  return <OtdWeeklyChart data={data} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries (unified: state + late + date range)
// ──────────────────────────────────────────────────────────────────────────
const deliveryStateLabel: Record<string, string> = {
  draft: "Borrador",
  waiting: "Esperando",
  confirmed: "Confirmada",
  assigned: "Asignada",
  done: "Completada",
  cancel: "Cancelada",
};

const pickingTypeLabel: Record<string, string> = {
  outgoing: "Salida",
  incoming: "Entrada",
  internal: "Interno",
};

const deliveryViewColumns = [
  { key: "name", label: "Movimiento", alwaysVisible: true },
  { key: "type", label: "Tipo" },
  { key: "company", label: "Empresa" },
  { key: "origin", label: "Origen" },
  { key: "scheduled", label: "Programada" },
  { key: "done", label: "Completada", defaultHidden: true },
  { key: "state", label: "Estado" },
];

const deliveryColumns: DataTableColumn<DeliveryRow>[] = [
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
    cell: (r) => pickingTypeLabel[r.picking_type_code ?? ""] ?? "—",
    hideOnMobile: true,
  },
  {
    key: "company",
    header: "Empresa",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "origin",
    header: "Origen",
    cell: (r) => (
      <span className="font-mono text-[10px]">{r.origin ?? "—"}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "scheduled",
    header: "Programada",
    sortable: true,
    cell: (r) => <DateDisplay date={r.scheduled_date} relative />,
  },
  {
    key: "done",
    header: "Completada",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <DateDisplay date={r.date_done} />,
  },
  {
    key: "state",
    header: "Estado",
    sortable: true,
    cell: (r) =>
      r.is_late && r.state && r.state !== "done" && r.state !== "cancel" ? (
        <StatusBadge status="overdue" />
      ) : (
        <Badge variant="secondary">
          {deliveryStateLabel[r.state ?? ""] ?? r.state ?? "—"}
        </Badge>
      ),
  },
];

async function DeliveriesTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "dl_",
    facetKeys: ["state", "picking_type", "late"],
    defaultSize: 25,
    defaultSort: "scheduled",
  });
  const { rows, total } = await getDeliveriesPage({
    ...params,
    state: params.facets.state,
    picking_type: params.facets.picking_type,
    onlyLate: (params.facets.late ?? []).includes("1"),
  });
  const visibleKeys = parseVisibleKeys(searchParams, "dl_");
  const sortHref = makeSortHref({
    pathname: "/operaciones",
    searchParams,
    paramPrefix: "dl_",
  });
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Sin entregas"
        description="Ajusta los filtros o el rango de fechas."
        compact
      />
    );
  }
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
            title={
              r.company_id ? (
                <CompanyLink
                  companyId={r.company_id}
                  name={r.company_name}
                  truncate
                />
              ) : (
                (r.company_name ?? r.name ?? "—")
              )
            }
            subtitle={r.name ?? undefined}
            badge={
              r.is_late &&
              r.state !== "done" &&
              r.state !== "cancel" ? (
                <StatusBadge status="overdue" />
              ) : (
                <Badge variant="secondary">
                  {deliveryStateLabel[r.state ?? ""] ?? r.state ?? "—"}
                </Badge>
              )
            }
            fields={[
              {
                label: "Tipo",
                value: pickingTypeLabel[r.picking_type_code ?? ""] ?? "—",
              },
              {
                label: "Programada",
                value: <DateDisplay date={r.scheduled_date} relative />,
              },
              {
                label: "Origen",
                value: r.origin ?? "—",
                className: "col-span-2",
              },
            ]}
          />
        )}
      />
      <DataTablePagination
        paramPrefix="dl_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="entregas"
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Manufacturing
// ──────────────────────────────────────────────────────────────────────────
const mfgStateVariant: Record<string, "info" | "warning" | "secondary"> = {
  progress: "info",
  confirmed: "warning",
  to_close: "warning",
  draft: "secondary",
};
const mfgStateLabel: Record<string, string> = {
  progress: "En curso",
  confirmed: "Confirmada",
  to_close: "Por cerrar",
  draft: "Borrador",
};

const manufacturingViewColumns = [
  { key: "name", label: "Orden", alwaysVisible: true },
  { key: "product", label: "Producto" },
  { key: "origin", label: "Origen", defaultHidden: true },
  { key: "progress", label: "Progreso" },
  { key: "planned", label: "Planeado", defaultHidden: true },
  { key: "produced", label: "Producido", defaultHidden: true },
  { key: "start", label: "Inicio", defaultHidden: true },
  { key: "finish", label: "Fin planeado", defaultHidden: true },
  { key: "assigned", label: "Responsable" },
  { key: "state", label: "Estado" },
];

const mfgColumns: DataTableColumn<ManufacturingRow>[] = [
  {
    key: "name",
    header: "Orden",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "origin",
    header: "Origen",
    defaultHidden: true,
    cell: (r) => <span className="font-mono text-[10px]">{r.origin ?? "—"}</span>,
  },
  {
    key: "progress",
    header: "Progreso",
    cell: (r) => {
      const pct =
        r.qty_planned > 0
          ? Math.min(100, Math.round((r.qty_produced / r.qty_planned) * 100))
          : 0;
      return (
        <div className="flex items-center gap-2">
          <Progress value={pct} className="h-1.5 w-16" />
          <span className="tabular-nums text-[11px]">{pct}%</span>
        </div>
      );
    },
  },
  {
    key: "planned",
    header: "Planeado",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.qty_planned)}</span>
    ),
    align: "right",
  },
  {
    key: "produced",
    header: "Producido",
    sortable: true,
    defaultHidden: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.qty_produced)}</span>
    ),
    align: "right",
  },
  {
    key: "start",
    header: "Inicio",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <DateDisplay date={r.date_start} relative />,
  },
  {
    key: "finish",
    header: "Fin plan.",
    sortable: true,
    defaultHidden: true,
    cell: (r) => <DateDisplay date={r.date_finished} />,
  },
  {
    key: "assigned",
    header: "Responsable",
    cell: (r) => r.assigned_user ?? "—",
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    sortable: true,
    cell: (r) => (
      <Badge variant={mfgStateVariant[r.state ?? ""] ?? "secondary"}>
        {mfgStateLabel[r.state ?? ""] ?? r.state ?? "—"}
      </Badge>
    ),
  },
];

async function ManufacturingToolbar() {
  const assignees = await getManufacturingAssigneeOptions();
  return (
    <DataTableToolbar
      paramPrefix="mfg_"
      searchPlaceholder="Orden, producto u origen…"
      dateRange={{ label: "Fecha inicio" }}
      facets={[
        {
          key: "state",
          label: "Estado",
          options: [
            { value: "draft", label: "Borrador" },
            { value: "confirmed", label: "Confirmada" },
            { value: "progress", label: "En curso" },
            { value: "to_close", label: "Por cerrar" },
            { value: "done", label: "Hecha" },
            { value: "cancel", label: "Cancelada" },
          ],
        },
        {
          key: "assigned",
          label: "Responsable",
          options: assignees.map((a) => ({ value: a, label: a })),
        },
      ]}
    />
  );
}

async function ManufacturingTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "mfg_",
    facetKeys: ["state", "assigned"],
    defaultSize: 25,
    defaultSort: "start",
  });
  const { rows, total } = await getManufacturingPage({
    ...params,
    state: params.facets.state,
    assigned: params.facets.assigned,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "mfg_");
  const sortHref = makeSortHref({
    pathname: "/operaciones",
    searchParams,
    paramPrefix: "mfg_",
  });
  return (
    <div className="space-y-3">
    <DataTable
      data={rows}
      columns={mfgColumns}
      rowKey={(r) => String(r.id)}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => {
        const pct =
          r.qty_planned > 0
            ? Math.min(
                100,
                Math.round((r.qty_produced / r.qty_planned) * 100)
              )
            : 0;
        return (
          <MobileCard
            title={r.product_name ?? r.name ?? "—"}
            subtitle={r.name ?? undefined}
            badge={
              <Badge variant={mfgStateVariant[r.state ?? ""] ?? "secondary"}>
                {mfgStateLabel[r.state ?? ""] ?? r.state ?? "—"}
              </Badge>
            }
            fields={[
              {
                label: "Progreso",
                value: (
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-1.5 w-12" />
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                ),
                className: "col-span-2",
              },
              {
                label: "Planeado",
                value: Math.round(r.qty_planned),
              },
              {
                label: "Producido",
                value: Math.round(r.qty_produced),
              },
              {
                label: "Asignado",
                value: r.assigned_user ?? "—",
                className: "col-span-2",
              },
            ]}
          />
        );
      }}
      emptyState={{
        icon: Factory,
        title: "Sin manufactura",
        description: "Ajusta los filtros o el rango de fechas.",
      }}
    />
    <DataTablePagination
      paramPrefix="mfg_"
      total={total}
      page={params.page}
      pageSize={params.size}
      unit="órdenes"
    />
    </div>
  );
}

