import { Suspense } from "react";
import { Activity, Truck, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  DateDisplay,
  StatusBadge,
  makeSortHref,
  type DataTableColumn,
} from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import {
  getCompanyDeliveriesPage,
  getCompanyActivities,
  type CompanyDeliveryRow,
  type CompanyActivityRow,
} from "@/lib/queries/companies";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import type { CompanyDetail } from "@/lib/queries/companies";

type SearchParams = Record<string, string | string[] | undefined>;

interface Props {
  company: CompanyDetail;
  searchParams: SearchParams;
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries section
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
  companyName,
}: {
  companyId: number;
  searchParams: SearchParams;
  companyName: string;
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
// Activities section
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
    cell: (r) => <span className="truncate">{r.summary ?? "—"}</span>,
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

// ──────────────────────────────────────────────────────────────────────────
// Operativo tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function OperativoTab({ company, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Entregas</CardTitle>
            <p className="text-xs text-muted-foreground">
              ¿Estamos entregando a tiempo? ¿Qué quedó pendiente?
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source="odoo" refresh="1h" />
            <TableViewOptions
              paramPrefix="cd_"
              columns={companyDeliveriesViewColumns}
            />
            <TableExportButton filename={`${company.name}-deliveries`} />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <DeliveriesSection
              companyId={company.id}
              searchParams={searchParams}
              companyName={company.name}
            />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Actividades pendientes</CardTitle>
              <p className="text-xs text-muted-foreground">
                Tareas con deadline pendiente relacionadas con este cliente.
              </p>
            </div>
            <DataSourceBadge source="odoo" refresh="1h" />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
            <ActivitiesSection companyId={company.id} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
