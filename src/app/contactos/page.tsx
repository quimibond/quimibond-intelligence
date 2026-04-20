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
  PageLayout,
  KpiCard,
  StatGrid,
  PageHeader,
  DataView,
  DataViewChart,
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
  type DataViewChartSpec,
  type DataViewMode,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getContactsPage,
  getContactsKpis,
  type ContactListRow,
} from "@/lib/queries/_shared/contacts";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/_shared/table-params";

export const revalidate = 60; // 60s ISR cache · data freshness OK (pg_cron 15min)
export const metadata = { title: "Contactos" };

type SearchParams = Record<string, string | string[] | undefined>;

function buildContactsHref(
  sp: SearchParams,
  updates: Record<string, string | null>
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `/contactos?${s}` : "/contactos";
}

function parseViewParam(sp: SearchParams, key: string): DataViewMode {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "chart" ? "chart" : "table";
}

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
    <PageLayout>
      <PageHeader
        title="Contactos"
        subtitle="¿Con qué personas trato, cómo está cada relación y quién está en riesgo?"
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
    </PageLayout>
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
    pathname: "/contactos",
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

  const view = parseViewParam(searchParams, "view");

  // Donut summary: distribución por risk_level sobre la página actual.
  const riskCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.risk_level ?? "—";
    riskCounts.set(k, (riskCounts.get(k) ?? 0) + 1);
  }
  const riskSummary = Array.from(riskCounts.entries())
    .map(([risk, count]) => ({ risk, count, label: riskLabel[risk] ?? risk }))
    .sort(
      (a, b) =>
        ["critical", "high", "medium", "low", "—"].indexOf(a.risk) -
        ["critical", "high", "medium", "low", "—"].indexOf(b.risk)
    );
  const riskDonut: DataViewChartSpec = {
    type: "donut",
    xKey: "label",
    series: [{ dataKey: "count", label: "Contactos" }],
    valueFormat: "number",
    donutCenterLabel: String(rows.length),
    colorBy: "risk",
    colorMap: {
      low: "var(--chart-2)",
      medium: "var(--chart-3)",
      high: "var(--chart-4)",
      critical: "var(--destructive)",
    },
    height: 220,
  };

  // Scatter: health_score × sentiment_score, colorBy risk_level.
  const scatterRows = rows
    .filter(
      (r) =>
        r.current_health_score != null && r.sentiment_score != null
    )
    .map((r) => ({
      ...r,
      // escalar sentiment (-1..1) a -100..100 para legibilidad en eje Y
      sentiment_scaled: Math.round((r.sentiment_score ?? 0) * 100),
    }));
  const scatterChart: DataViewChartSpec = {
    type: "scatter",
    xKey: "current_health_score",
    yKey: "sentiment_scaled",
    series: [
      { dataKey: "current_health_score", label: "Health score" },
      { dataKey: "sentiment_scaled", label: "Sentimiento" },
    ],
    valueFormat: "number",
    secondaryValueFormat: "number",
    colorBy: "risk_level",
    colorMap: {
      low: "var(--chart-2)",
      medium: "var(--chart-3)",
      high: "var(--chart-4)",
      critical: "var(--destructive)",
    },
    referenceLine: {
      value: 50,
      axis: "x",
      label: "Health 50",
    },
    rowHrefTemplate: "/contactos/{id}",
  };

  return (
    <div className="space-y-3">
      {riskSummary.length > 1 && view === "table" ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Distribución por riesgo · página actual
          </div>
          <DataViewChart
            data={riskSummary as unknown as Record<string, unknown>[]}
            chart={riskDonut}
          />
        </div>
      ) : null}
      <DataView
        data={rows}
        columns={contactColumns}
        chart={scatterChart}
        chartData={scatterRows as unknown as Record<string, unknown>[]}
        view={view}
        viewHref={(next) =>
          buildContactsHref(searchParams, {
            view: next === "chart" ? "chart" : null,
          })
        }
        rowKey={(r) => r.id}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        rowHref={(r) => `/contacts/${r.id}`}
        mobileCard={(r) => (
          <MobileCard
            title={r.name ?? "—"}
            subtitle={r.email ?? undefined}
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
                value: r.company_name ?? "—",
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
