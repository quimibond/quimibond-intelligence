import { Suspense } from "react";
import {
  AlertTriangle,
  Flame,
  Users,
  UserCheck,
  Building2,
  Inbox,
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
  EmptyState,
  makeSortHref,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getContactsPage,
  getContactsKpis,
  type ContactListRow,
} from "@/lib/queries/contacts";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contactos" };

type SearchParams = Record<string, string | string[] | undefined>;

const riskVariant: Record<
  string,
  "success" | "info" | "warning" | "danger" | "secondary"
> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

const riskLabel: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

function healthColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-info";
  if (score >= 40) return "text-warning";
  return "text-danger";
}

const contactViewColumns = [
  { key: "name", label: "Nombre", alwaysVisible: true },
  { key: "email", label: "Email" },
  { key: "company", label: "Empresa" },
  { key: "type", label: "Tipo" },
  { key: "position", label: "Puesto", defaultHidden: true },
  { key: "phone", label: "Teléfono", defaultHidden: true },
  { key: "health", label: "Health score" },
  { key: "sentiment", label: "Sentimiento", defaultHidden: true },
  { key: "risk", label: "Riesgo" },
  { key: "activity", label: "Última actividad" },
];

const contactColumns: DataTableColumn<ContactListRow>[] = [
  {
    key: "name",
    header: "Nombre",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate">{r.name ?? "—"}</span>
        {r.position && (
          <span className="text-[11px] text-muted-foreground truncate">
            {r.position}
          </span>
        )}
      </div>
    ),
  },
  {
    key: "email",
    header: "Email",
    sortable: true,
    cell: (r) =>
      r.email ? (
        <a
          href={`mailto:${r.email}`}
          className="text-xs text-muted-foreground hover:text-foreground truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {r.email}
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "company",
    header: "Empresa",
    cell: (r) =>
      r.company_id && r.company_name ? (
        <CompanyLink
          companyId={r.company_id}
          name={r.company_name}
          truncate
        />
      ) : r.company ? (
        <span className="truncate text-xs">{r.company}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "type",
    header: "Tipo",
    cell: (r) => (
      <div className="flex gap-1">
        {r.is_customer && (
          <Badge variant="info" className="text-[10px]">
            Cliente
          </Badge>
        )}
        {r.is_supplier && (
          <Badge variant="secondary" className="text-[10px]">
            Proveedor
          </Badge>
        )}
      </div>
    ),
    hideOnMobile: true,
  },
  {
    key: "position",
    header: "Puesto",
    defaultHidden: true,
    cell: (r) => <span className="text-xs">{r.position ?? "—"}</span>,
  },
  {
    key: "phone",
    header: "Teléfono",
    defaultHidden: true,
    cell: (r) => (
      <span className="font-mono text-xs">{r.phone ?? "—"}</span>
    ),
  },
  {
    key: "health",
    header: "Health",
    sortable: true,
    cell: (r) => (
      <span
        className={`font-semibold tabular-nums ${healthColor(r.current_health_score)}`}
      >
        {r.current_health_score != null
          ? Math.round(r.current_health_score)
          : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "sentiment",
    header: "Sentimiento",
    defaultHidden: true,
    sortable: true,
    cell: (r) =>
      r.sentiment_score != null ? (
        <span
          className={`tabular-nums ${
            r.sentiment_score >= 0.5
              ? "text-success"
              : r.sentiment_score >= 0
                ? "text-info"
                : "text-warning"
          }`}
        >
          {r.sentiment_score.toFixed(2)}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "risk",
    header: "Riesgo",
    sortable: true,
    cell: (r) =>
      r.risk_level ? (
        <Badge variant={riskVariant[r.risk_level] ?? "secondary"}>
          {riskLabel[r.risk_level] ?? r.risk_level}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "activity",
    header: "Última actividad",
    sortable: true,
    cell: (r) => <DateDisplay date={r.last_activity} relative />,
    hideOnMobile: true,
  },
];

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Contactos"
        subtitle="Personas con health score, sentiment y riesgo detectado por los agentes"
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 5 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <ContactsHeroKpis />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataTableToolbar
          searchPlaceholder="Nombre, email o empresa…"
          facets={[
            {
              key: "risk",
              label: "Riesgo",
              options: [
                { value: "low", label: "Bajo" },
                { value: "medium", label: "Medio" },
                { value: "high", label: "Alto" },
                { value: "critical", label: "Crítico" },
              ],
            },
            {
              key: "type",
              label: "Tipo",
              options: [
                { value: "customer", label: "Cliente" },
                { value: "supplier", label: "Proveedor" },
              ],
            },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <TableViewOptions columns={contactViewColumns} />
          <TableExportButton filename="contactos" />
        </div>
      </div>

      <div data-table-export-root>
        <Suspense
          fallback={
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          }
        >
          <ContactsTable searchParams={sp} />
        </Suspense>
      </div>
    </div>
  );
}

async function ContactsHeroKpis() {
  const k = await getContactsKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 5 }}>
      <KpiCard title="Total contactos" value={k.total} format="number" icon={Users} />
      <KpiCard
        title="Clientes"
        value={k.customers}
        format="number"
        icon={UserCheck}
        tone="info"
      />
      <KpiCard
        title="Proveedores"
        value={k.suppliers}
        format="number"
        icon={Building2}
      />
      <KpiCard
        title="En riesgo alto/crítico"
        value={k.atRisk}
        format="number"
        icon={Flame}
        tone={k.atRisk > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Insights activos"
        value={k.activeInsights}
        format="number"
        icon={Inbox}
        subtitle="asociados a contactos"
      />
    </StatGrid>
  );
}

async function ContactsTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    facetKeys: ["risk", "type"],
    defaultSize: 25,
    defaultSort: "-health",
  });
  const { rows, total } = await getContactsPage({
    ...params,
    risk: params.facets.risk,
    type: params.facets.type,
  });
  const visibleKeys = parseVisibleKeys(searchParams);
  const sortHref = makeSortHref({
    pathname: "/contacts",
    searchParams,
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin contactos"
        description="Ajusta tus filtros — no hay resultados."
      />
    );
  }

  return (
    <div className="space-y-3">
      <DataTable
        data={rows}
        columns={contactColumns}
        rowKey={(r) => r.id}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        rowHref={(r) => `/contacts/${r.id}`}
        mobileCard={(r) => (
          <MobileCard
            title={r.name ?? "—"}
            subtitle={r.position ?? r.email ?? undefined}
            badge={
              r.risk_level ? (
                <Badge variant={riskVariant[r.risk_level] ?? "secondary"}>
                  {riskLabel[r.risk_level] ?? r.risk_level}
                </Badge>
              ) : undefined
            }
            fields={[
              {
                label: "Health",
                value: (
                  <span
                    className={`font-semibold tabular-nums ${healthColor(r.current_health_score)}`}
                  >
                    {r.current_health_score != null
                      ? Math.round(r.current_health_score)
                      : "—"}
                  </span>
                ),
              },
              {
                label: "Empresa",
                value: r.company_name ?? r.company ?? "—",
                className: "truncate",
              },
              {
                label: "Última",
                value: <DateDisplay date={r.last_activity} relative />,
              },
            ]}
          />
        )}
      />
      <DataTablePagination
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="contactos"
      />
    </div>
  );
}
