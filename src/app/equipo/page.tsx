import { Suspense } from "react";
import {
  AlertTriangle,
  Building,
  CheckSquare,
  Inbox,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  TableExportButton,
  MobileCard,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getTeamKpis,
  getUserBacklog,
  getDepartments,
  getInsightsByDepartment,
  getEmployees,
  type UserBacklogRow,
  type DepartmentRow,
  type InsightsByDepartment,
  type EmployeeRow,
} from "@/lib/queries/team";
import { formatNumber } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipo" };

export default function EquipoPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Equipo"
        subtitle="Backlog de actividades por persona, departamentos e insights"
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
        <TeamHeroKpis />
      </Suspense>

      {/* Backlog crítico */}
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">
            Backlog de actividades por persona
          </CardTitle>
          <TableExportButton filename="team-backlog" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <BacklogTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">
            Insights activos por departamento
          </CardTitle>
          <TableExportButton filename="insights-by-department" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <InsightsByDeptTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">
            Departamentos y responsables
          </CardTitle>
          <TableExportButton filename="departments" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={<Skeleton className="h-[300px] rounded-xl" />}
          >
            <DepartmentsList />
          </Suspense>
        </CardContent>
      </Card>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">Plantilla activa</CardTitle>
          <TableExportButton filename="employees" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <EmployeesTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero KPIs
// ──────────────────────────────────────────────────────────────────────────
async function TeamHeroKpis() {
  const k = await getTeamKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Empleados"
        value={k.employees}
        format="number"
        icon={Users}
        subtitle={`${k.departments} departamentos`}
      />
      <KpiCard
        title="Actividades pendientes"
        value={k.totalPending}
        format="number"
        icon={CheckSquare}
        subtitle={`${k.usersWithBacklog} personas con backlog`}
      />
      <KpiCard
        title="Vencidas"
        value={k.totalOverdue}
        format="number"
        icon={AlertTriangle}
        subtitle={`${
          k.totalPending > 0
            ? Math.round((k.totalOverdue / k.totalPending) * 100)
            : 0
        }% del total`}
        tone={k.totalOverdue > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Insights activos"
        value={k.insightsActive}
        format="number"
        icon={Inbox}
        subtitle="por accionar"
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Backlog
// ──────────────────────────────────────────────────────────────────────────
const backlogColumns: DataTableColumn<UserBacklogRow>[] = [
  {
    key: "user",
    header: "Persona",
    cell: (r) => (
      <div className="flex flex-col">
        <span className="font-semibold truncate">{r.name}</span>
        {r.job_title && (
          <span className="text-[10px] text-muted-foreground truncate">
            {r.job_title}
          </span>
        )}
      </div>
    ),
  },
  {
    key: "department",
    header: "Depto",
    cell: (r) => r.department ?? "—",
    hideOnMobile: true,
  },
  {
    key: "pending",
    header: "Pendientes",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        {formatNumber(r.pending)}
      </span>
    ),
    align: "right",
  },
  {
    key: "overdue",
    header: "Vencidas",
    cell: (r) => (
      <span
        className={
          r.overdue > 0
            ? "font-bold tabular-nums text-danger"
            : "tabular-nums text-muted-foreground"
        }
      >
        {formatNumber(r.overdue)}
      </span>
    ),
    align: "right",
  },
  {
    key: "insights",
    header: "Insights",
    cell: (r) =>
      r.insights_assigned > 0 ? (
        <Badge variant="info" className="text-[10px]">
          {r.insights_assigned}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
];

async function BacklogTable() {
  const rows = await getUserBacklog(30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="Sin backlog"
        description="Nadie tiene actividades pendientes."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={backlogColumns}
      rowKey={(r) => String(r.user_id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name}
          subtitle={r.job_title ?? r.department ?? undefined}
          badge={
            r.overdue > 0 ? (
              <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger-foreground">
                {formatNumber(r.overdue)} vencidas
              </span>
            ) : (
              <span className="rounded bg-info/15 px-2 py-0.5 text-[11px] font-semibold">
                {formatNumber(r.pending)} pendientes
              </span>
            )
          }
          fields={[
            {
              label: "Pendientes",
              value: formatNumber(r.pending),
            },
            {
              label: "Vencidas",
              value: formatNumber(r.overdue),
              className: r.overdue > 0 ? "text-danger font-semibold" : "",
            },
            {
              label: "Insights",
              value: r.insights_assigned,
            },
            {
              label: "Depto",
              value: r.department ?? "—",
            },
          ]}
        />
      )}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Insights by department
// ──────────────────────────────────────────────────────────────────────────
const insightsDeptColumns: DataTableColumn<InsightsByDepartment>[] = [
  {
    key: "department",
    header: "Departamento",
    cell: (r) => <span className="font-semibold">{r.department}</span>,
  },
  {
    key: "total",
    header: "Activos",
    cell: (r) => (
      <span className="font-semibold tabular-nums">{r.total_active}</span>
    ),
    align: "right",
  },
  {
    key: "critical",
    header: "Críticos",
    cell: (r) =>
      r.critical > 0 ? (
        <Badge variant="critical" className="text-[10px]">
          {r.critical}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
  },
  {
    key: "high",
    header: "Altos",
    cell: (r) =>
      r.high > 0 ? (
        <Badge variant="warning" className="text-[10px]">
          {r.high}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
];

async function InsightsByDeptTable() {
  const rows = await getInsightsByDepartment();
  return (
    <DataTable
      data={rows}
      columns={insightsDeptColumns}
      rowKey={(r) => r.department}
      mobileCard={(r) => (
        <MobileCard
          title={r.department}
          badge={
            r.critical > 0 ? (
              <Badge variant="critical">{r.critical} críticos</Badge>
            ) : r.high > 0 ? (
              <Badge variant="warning">{r.high} altos</Badge>
            ) : undefined
          }
          fields={[
            { label: "Activos", value: r.total_active },
            { label: "Críticos", value: r.critical },
            { label: "Altos", value: r.high },
          ]}
        />
      )}
      emptyState={{
        icon: Inbox,
        title: "Sin insights por departamento",
        description: "No hay insights asignados.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Departments list
// ──────────────────────────────────────────────────────────────────────────
async function DepartmentsList() {
  const rows = await getDepartments();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building}
        title="Sin departamentos"
        description="No hay departamentos activos."
        compact
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((d) => (
        <DepartmentCard key={d.id} dept={d} />
      ))}
    </div>
  );
}

function DepartmentCard({ dept: d }: { dept: DepartmentRow }) {
  return (
    <Card className="gap-1 py-3">
      <div className="flex items-start gap-2 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Building className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{d.name}</div>
          {d.lead_name ? (
            <div className="text-[11px] text-muted-foreground">
              Lead: {d.lead_name}
            </div>
          ) : (
            <div className="text-[11px] text-warning-foreground">
              Sin lead asignado
            </div>
          )}
          {d.description && (
            <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
              {d.description}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Employees
// ──────────────────────────────────────────────────────────────────────────
const employeeColumns: DataTableColumn<EmployeeRow>[] = [
  {
    key: "name",
    header: "Nombre",
    cell: (r) => <span className="font-semibold truncate">{r.name ?? "—"}</span>,
  },
  {
    key: "department",
    header: "Departamento",
    cell: (r) => r.department_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "job",
    header: "Puesto",
    cell: (r) => r.job_title ?? "—",
  },
  {
    key: "manager",
    header: "Manager",
    cell: (r) => r.manager_name ?? "—",
    hideOnMobile: true,
  },
];

async function EmployeesTable() {
  const rows = await getEmployees(150);
  return (
    <DataTable
      data={rows}
      columns={employeeColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={r.job_title ?? undefined}
          fields={[
            { label: "Depto", value: r.department_name ?? "—" },
            { label: "Manager", value: r.manager_name ?? "—" },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin empleados",
        description: "No hay empleados activos.",
      }}
    />
  );
}
