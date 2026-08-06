import { Suspense } from "react";
import {
  AlertTriangle,
  Building,
  CheckSquare,
  Inbox,
  Users,
} from "lucide-react";

import {
  PageLayout,
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  TableExportButton,
  SectionNav,
  MobileCard,
  EmptyState,
  type DataTableColumn,
} from "@/components/patterns";
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
} from "@/lib/queries/operational/team";
import { formatNumber, formatRelative } from "@/lib/formatters";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import Link from "next/link";
import {
  getMailboxActivity,
  getMailboxThreads,
  type MailboxActivity,
  type MailboxThread,
} from "@/lib/queries/sp13/comunicacion";

export const revalidate = 60; // 60s ISR cache · data freshness OK (pg_cron 15min)
export const metadata = { title: "Equipo" };

interface EquipoPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EquipoPage({ searchParams }: EquipoPageProps) {
  const sp = await searchParams;
  const rawBuzon = typeof sp.buzon === "string" ? sp.buzon : undefined;
  // Solo aceptar buzones del dominio para evitar params arbitrarios
  const buzon = rawBuzon && /^[a-z0-9._-]+@quimibond\.com(\.mx)?$/i.test(rawBuzon) ? rawBuzon : undefined;

  return (
    <PageLayout>
      <PageHeader
        title="Equipo"
        subtitle="¿Quién tiene backlog, qué comunicación pendiente y cómo está distribuido?"
        actions={<DataSourceBadge source="odoo" coverage="2021+" />}
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "comunicacion", label: "Comunicación" },
          { id: "backlog", label: "Backlog" },
          { id: "insights-dept", label: "Insights por depto" },
          { id: "departments", label: "Departamentos" },
          { id: "employees", label: "Plantilla" },
        ]}
      />

      <section id="kpis" className="scroll-mt-24">
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
      </section>

      {/* Comunicación por integrante */}
      <section id="comunicacion" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">
            Comunicación por integrante
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              clic en un buzón para ver sus últimos hilos
            </span>
          </CardTitle>
          <TableExportButton filename="team-mailboxes" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
            <MailboxSection selected={buzon} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Backlog crítico */}
      <section id="backlog" className="scroll-mt-24">
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
      </section>

      <section id="insights-dept" className="scroll-mt-24">
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
      </section>

      <section id="departments" className="scroll-mt-24">
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
      </section>

      <section id="employees" className="scroll-mt-24">
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
      </section>
    </PageLayout>
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
    summary: (rows) => (
      <span className="font-bold tabular-nums">
        {formatNumber(rows.reduce((s, r) => s + (r.pending ?? 0), 0))}
      </span>
    ),
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
    summary: (rows) => {
      const total = rows.reduce((s, r) => s + (r.overdue ?? 0), 0);
      return (
        <span
          className={
            total > 0
              ? "font-bold tabular-nums text-danger"
              : "tabular-nums text-muted-foreground"
          }
        >
          {formatNumber(total)}
        </span>
      );
    },
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
    summary: (rows) => (
      <span className="font-bold tabular-nums">
        {formatNumber(
          rows.reduce((s, r) => s + (r.insights_assigned ?? 0), 0)
        )}
      </span>
    ),
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
              <Badge variant="danger" className="font-bold">
                {formatNumber(r.overdue)} vencidas
              </Badge>
            ) : (
              <Badge variant="info" className="font-semibold">
                {formatNumber(r.pending)} pendientes
              </Badge>
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

// ──────────────────────────────────────────────────────────────────────────
// Comunicación por integrante (rediseño 2026-08-06)
// ──────────────────────────────────────────────────────────────────────────
const mailboxColumns = (selected?: string): DataTableColumn<MailboxActivity>[] => [
  {
    key: "account",
    header: "Buzón",
    cell: (r) => (
      <Link
        href={`/equipo?buzon=${encodeURIComponent(r.account)}#comunicacion`}
        className={
          r.account === selected ? "font-semibold underline" : "font-medium hover:underline"
        }
      >
        {r.personName ?? r.account.split("@")[0]}
        <span className="block text-xs font-normal text-muted-foreground">{r.account}</span>
      </Link>
    ),
  },
  {
    key: "sinRespuesta",
    header: "Sin responder",
    align: "right",
    cell: (r) =>
      r.sinRespuesta > 0 ? (
        <Badge variant="destructive">{r.sinRespuesta}</Badge>
      ) : (
        <span className="text-muted-foreground">0</span>
      ),
  },
  {
    key: "recibidos7d",
    header: "Recibidos 7d",
    align: "right",
    cell: (r) => formatNumber(r.recibidos7d),
    hideOnMobile: true,
  },
  {
    key: "enviados7d",
    header: "Enviados 7d",
    align: "right",
    cell: (r) => formatNumber(r.enviados7d),
    hideOnMobile: true,
  },
  {
    key: "lastActivity",
    header: "Último movimiento",
    cell: (r) => (r.lastActivity ? formatRelative(r.lastActivity) : "—"),
  },
];

const mailboxThreadColumns: DataTableColumn<MailboxThread>[] = [
  {
    key: "subject",
    header: "Asunto",
    cell: (r) => (
      <span className="line-clamp-1">
        {r.esperandoRespuesta && (
          <Badge variant="destructive" className="mr-1 align-middle">
            esperando
          </Badge>
        )}
        {r.subject ?? "(sin asunto)"}
      </span>
    ),
  },
  {
    key: "companyName",
    header: "Cliente / contraparte",
    cell: (r) =>
      r.companyId ? (
        <Link href={`/empresas/${r.companyId}`} className="text-muted-foreground hover:underline">
          {r.companyName ?? "—"}
        </Link>
      ) : (
        <span className="text-muted-foreground">{r.lastSender ?? "—"}</span>
      ),
  },
  {
    key: "messageCount",
    header: "Msgs",
    align: "right",
    cell: (r) => r.messageCount,
    hideOnMobile: true,
  },
  {
    key: "lastActivity",
    header: "Último mensaje",
    cell: (r) => formatRelative(r.lastActivity),
  },
];

async function MailboxSection({ selected }: { selected?: string }) {
  const activity = await getMailboxActivity();
  const threads = selected ? await getMailboxThreads(selected) : null;

  return (
    <div className="space-y-6">
      <DataTable
        data={activity}
        columns={mailboxColumns(selected)}
        rowKey={(r) => r.account}
        density="compact"
        emptyState={{ icon: Inbox, title: "Sin actividad de correo" }}
      />

      {selected && threads && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Últimos hilos de <span className="font-mono">{selected}</span>
          </h3>
          <DataTable
            data={threads}
            columns={mailboxThreadColumns}
            rowKey={(r) => String(r.threadId)}
            density="compact"
            emptyState={{ icon: Inbox, title: "Sin hilos recientes" }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            &ldquo;Esperando&rdquo; = el último mensaje es del cliente y aún no hay respuesta de este buzón.
          </p>
        </div>
      )}
    </div>
  );
}
