import { Suspense } from "react";
import { Clock, Factory, Package, Truck } from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  CompanyLink,
  DateDisplay,
  StatusBadge,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getOperationsKpis,
  getRecentDeliveries,
  type DeliveryRow,
} from "@/lib/queries/operations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operaciones" };

export default function OperacionesPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Operaciones"
        subtitle="Entregas, manufactura y lead times"
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
        <OpsKpis />
      </Suspense>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Entregas recientes</h2>
        <Suspense
          fallback={
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          }
        >
          <DeliveriesTable />
        </Suspense>
      </section>
    </div>
  );
}

async function OpsKpis() {
  const k = await getOperationsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="OTD rate"
        value={k.otdPct}
        format="percent"
        icon={Truck}
        subtitle="última semana"
        tone={
          k.otdPct == null
            ? "default"
            : k.otdPct >= 90
              ? "success"
              : k.otdPct >= 75
                ? "warning"
                : "danger"
        }
      />
      <KpiCard
        title="Entregas tarde"
        value={k.lateDeliveries}
        format="number"
        icon={Clock}
        tone={k.lateDeliveries > 0 ? "warning" : "default"}
      />
      <KpiCard
        title="Producción activa"
        value={k.mfgActive}
        format="number"
        icon={Factory}
      />
      <KpiCard
        title="Lead time promedio"
        value={k.avgLeadTimeDays}
        format="days"
        icon={Package}
      />
    </StatGrid>
  );
}

const columns: DataTableColumn<DeliveryRow>[] = [
  {
    key: "name",
    header: "Movimiento",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "type",
    header: "Tipo",
    cell: (r) => (r.picking_type_code === "outgoing" ? "Salida" : r.picking_type_code === "incoming" ? "Entrada" : "—"),
    hideOnMobile: true,
  },
  {
    key: "company",
    header: "Empresa",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
      ) : (
        (r.company_name ?? "—")
      ),
  },
  {
    key: "scheduled",
    header: "Programada",
    cell: (r) => <DateDisplay date={r.scheduled_date} />,
    hideOnMobile: true,
  },
  {
    key: "late",
    header: "Estado",
    cell: (r) =>
      r.is_late ? (
        <StatusBadge status="overdue" />
      ) : r.date_done ? (
        <StatusBadge status="delivered" />
      ) : (
        <StatusBadge status={r.state ?? "pending"} />
      ),
  },
];

async function DeliveriesTable() {
  const rows = await getRecentDeliveries(30);
  return (
    <DataTable
      data={rows}
      columns={columns}
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
            r.is_late ? (
              <StatusBadge status="overdue" />
            ) : r.date_done ? (
              <StatusBadge status="delivered" />
            ) : (
              <StatusBadge status={r.state ?? "pending"} />
            )
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
              value: <DateDisplay date={r.scheduled_date} />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Truck,
        title: "Sin entregas",
        description: "No hay movimientos registrados.",
      }}
    />
  );
}
