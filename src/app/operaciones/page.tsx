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
  MobileCard,
  CompanyLink,
  DateDisplay,
  StatusBadge,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

import {
  getOperationsKpis,
  getWeeklyTrend,
  getLateDeliveries,
  getPendingDeliveries,
  getActiveManufacturing,
  type LateDeliveryRow,
  type PendingDeliveryRow,
  type ManufacturingRow,
} from "@/lib/queries/operations";

import { OtdWeeklyChart } from "./_components/otd-weekly-chart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operaciones" };

export default function OperacionesPage() {
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Entregas tarde abiertas
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
            <LateDeliveriesTable />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manufactura activa</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <ManufacturingTable />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entregas pendientes</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense
              fallback={<Skeleton className="h-[300px] rounded-xl" />}
            >
              <PendingDeliveriesTable />
            </Suspense>
          </CardContent>
        </Card>
      </div>
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
// Late deliveries
// ──────────────────────────────────────────────────────────────────────────
const lateColumns: DataTableColumn<LateDeliveryRow>[] = [
  {
    key: "name",
    header: "Movimiento",
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
    cell: (r) => <DateDisplay date={r.scheduled_date} relative />,
  },
  {
    key: "state",
    header: "Estado",
    cell: () => <StatusBadge status="overdue" />,
  },
];

async function LateDeliveriesTable() {
  const rows = await getLateDeliveries(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Sin entregas tarde"
        description="Todas las entregas están a tiempo."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={lateColumns}
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
              (r.company_name ?? r.name ?? "—")
            )
          }
          subtitle={r.name ?? undefined}
          badge={<StatusBadge status="overdue" />}
          fields={[
            {
              label: "Tipo",
              value:
                r.picking_type_code === "outgoing"
                  ? "Salida"
                  : r.picking_type_code === "incoming"
                    ? "Entrada"
                    : "—",
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

const mfgColumns: DataTableColumn<ManufacturingRow>[] = [
  {
    key: "name",
    header: "Orden",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "product",
    header: "Producto",
    cell: (r) => <span className="truncate">{r.product_name ?? "—"}</span>,
    hideOnMobile: true,
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
    key: "state",
    header: "Estado",
    cell: (r) => (
      <Badge variant={mfgStateVariant[r.state ?? ""] ?? "secondary"}>
        {mfgStateLabel[r.state ?? ""] ?? r.state ?? "—"}
      </Badge>
    ),
  },
];

async function ManufacturingTable() {
  const rows = await getActiveManufacturing(20);
  return (
    <DataTable
      data={rows}
      columns={mfgColumns}
      rowKey={(r) => String(r.id)}
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
        title: "Sin manufactura activa",
        description: "No hay órdenes de producción en curso.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pending deliveries
// ──────────────────────────────────────────────────────────────────────────
const pendingStateLabel: Record<string, string> = {
  assigned: "Asignada",
  confirmed: "Confirmada",
  waiting: "Esperando",
};

const pendingColumns: DataTableColumn<PendingDeliveryRow>[] = [
  {
    key: "name",
    header: "Movimiento",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
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
    hideOnMobile: true,
  },
  {
    key: "scheduled",
    header: "Programada",
    cell: (r) => <DateDisplay date={r.scheduled_date} relative />,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => (
      <Badge variant={r.is_late ? "critical" : "info"}>
        {pendingStateLabel[r.state ?? ""] ?? r.state ?? "—"}
      </Badge>
    ),
  },
];

async function PendingDeliveriesTable() {
  const rows = await getPendingDeliveries(20);
  return (
    <DataTable
      data={rows}
      columns={pendingColumns}
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
              (r.company_name ?? r.name ?? "—")
            )
          }
          subtitle={r.name ?? undefined}
          badge={
            <Badge variant={r.is_late ? "critical" : "info"}>
              {pendingStateLabel[r.state ?? ""] ?? r.state ?? "—"}
            </Badge>
          }
          fields={[
            {
              label: "Tipo",
              value:
                r.picking_type_code === "outgoing"
                  ? "Salida"
                  : r.picking_type_code === "incoming"
                    ? "Entrada"
                    : "—",
            },
            {
              label: "Programada",
              value: <DateDisplay date={r.scheduled_date} relative />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Package,
        title: "Sin entregas pendientes",
        description: "Todas las entregas están completadas.",
      }}
    />
  );
}
