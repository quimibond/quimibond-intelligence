import { Suspense } from "react";
import { AlertTriangle, Building, CheckSquare, Users } from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getTeamKpis,
  getTopActivityLoad,
  type EmployeeActivityLoad,
} from "@/lib/queries/team";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipo" };

export default function EquipoPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Equipo"
        subtitle="Empleados, departamentos y carga de actividades"
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
        <TeamKpisSection />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Carga de actividades por usuario
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <ActivityLoadTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function TeamKpisSection() {
  const k = await getTeamKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard title="Empleados" value={k.employees} icon={Users} format="number" />
      <KpiCard
        title="Departamentos"
        value={k.departments}
        icon={Building}
        format="number"
      />
      <KpiCard
        title="Actividades pendientes"
        value={k.activitiesPending}
        icon={CheckSquare}
        format="number"
      />
      <KpiCard
        title="Actividades vencidas"
        value={k.activitiesOverdue}
        icon={AlertTriangle}
        format="number"
        tone={k.activitiesOverdue > 0 ? "warning" : "default"}
      />
    </StatGrid>
  );
}

const columns: DataTableColumn<EmployeeActivityLoad>[] = [
  {
    key: "user",
    header: "Usuario",
    cell: (r) => r.user_name ?? "—",
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => (
      <span className="font-semibold tabular-nums">{r.activities_count}</span>
    ),
    align: "right",
  },
  {
    key: "overdue",
    header: "Vencidas",
    cell: (r) => (
      <span
        className={
          r.overdue_count > 0
            ? "font-semibold tabular-nums text-danger"
            : "tabular-nums text-muted-foreground"
        }
      >
        {r.overdue_count}
      </span>
    ),
    align: "right",
  },
];

async function ActivityLoadTable() {
  const rows = await getTopActivityLoad(20);
  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(r, i) => `${r.user_name ?? "u"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.user_name ?? "—"}
          fields={[
            { label: "Total", value: r.activities_count },
            { label: "Vencidas", value: r.overdue_count },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin actividades",
        description: "No hay actividades registradas.",
      }}
    />
  );
}
