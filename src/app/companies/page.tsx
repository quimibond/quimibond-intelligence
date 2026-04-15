/**
 * /companies — pregunta que responde:
 *   "¿Con quién hago negocio y qué pasa con cada cliente?"
 *
 * Secciones:
 *   1. Resumen          — KPIs del portfolio
 *   2. Reactivación     — clientes RFM en riesgo que vale la pena llamar
 *   3. Portfolio        — lista completa filtrable
 */
import { Suspense } from "react";
import { AlertTriangle, Building2, Phone, TrendingDown, Users } from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  SectionNav,
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  TrendIndicator,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCompaniesPage,
  type CompanyListRow,
} from "@/lib/queries/companies";
import {
  getRfmSegments,
  getRfmSegmentSummary,
  type RfmSegmentRow,
} from "@/lib/queries/analytics";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empresas" };

type SearchParams = Record<string, string | string[] | undefined>;

const statusVariant: Record<
  string,
  "success" | "warning" | "critical" | "secondary"
> = {
  active: "success",
  cooling: "warning",
  at_risk: "critical",
  churned: "secondary",
};

const statusLabel: Record<string, string> = {
  active: "Activo",
  cooling: "Enfriando",
  at_risk: "En riesgo",
  churned: "Perdido",
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Empresas"
        subtitle="Portfolio de clientes: revenue, tendencia y reactivación dirigida"
      />

      <SectionNav
        items={[
          { id: "resumen", label: "Resumen" },
          { id: "reactivacion", label: "Reactivación" },
          { id: "portfolio", label: "Portfolio completo" },
        ]}
      />

      <section id="resumen" className="scroll-mt-24">
        <Suspense
          fallback={
            <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[96px] rounded-xl" />
              ))}
            </StatGrid>
          }
        >
          <CompaniesResumen />
        </Suspense>
      </section>

      <section id="reactivacion" className="scroll-mt-24 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Reactivación dirigida</h2>
            <p className="text-xs text-muted-foreground">
              Clientes con historial alto que llevan tiempo sin comprar
              (segmentación RFM). Priorizado para que sepas a quién llamar
              primero.
            </p>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          }
        >
          <ReactivacionSection />
        </Suspense>
      </section>

      <section
        id="portfolio"
        className="scroll-mt-24 space-y-3"
        data-table-export-root
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Portfolio completo</h2>
            <p className="text-xs text-muted-foreground">
              Todas las empresas con filtros por tier, riesgo y búsqueda libre.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions columns={companyViewColumns} />
            <TableExportButton filename="companies" />
          </div>
        </div>

      <DataTableToolbar
        searchPlaceholder="Buscar empresa…"
        facets={[
          {
            key: "tier",
            label: "Tier",
            options: [
              { value: "A", label: "Tier A" },
              { value: "B", label: "Tier B" },
              { value: "C", label: "Tier C" },
            ],
          },
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
        ]}
      />

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        }
      >
        <CompaniesTable searchParams={sp} />
      </Suspense>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Resumen — KPIs del portfolio
// ──────────────────────────────────────────────────────────────────────────
async function CompaniesResumen() {
  const summary = await getRfmSegmentSummary();
  const total = summary.reduce((a, s) => a + s.customers, 0);
  const atRisk = summary.find((s) => s.segment === "AT_RISK");
  const needAtt = summary.find((s) => s.segment === "NEED_ATTENTION");
  const hibernating = summary.find((s) => s.segment === "HIBERNATING");
  const lost = summary.find((s) => s.segment === "LOST");
  const atRiskRevenue =
    (atRisk?.revenue_12m ?? 0) +
    (needAtt?.revenue_12m ?? 0) +
    (hibernating?.revenue_12m ?? 0);
  const atRiskCount =
    (atRisk?.customers ?? 0) +
    (needAtt?.customers ?? 0) +
    (hibernating?.customers ?? 0);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Empresas con revenue"
        value={total}
        format="number"
        icon={Building2}
      />
      <KpiCard
        title="En riesgo"
        value={atRiskCount}
        format="number"
        icon={AlertTriangle}
        subtitle="AT_RISK + NEED_ATT + HIBERNATING"
        tone={atRiskCount > 0 ? "warning" : "success"}
      />
      <KpiCard
        title="Revenue en juego"
        value={atRiskRevenue}
        format="currency"
        compact
        icon={Phone}
        subtitle="12m de clientes reactivables"
        tone="info"
      />
      <KpiCard
        title="Perdidos"
        value={lost?.customers ?? 0}
        format="number"
        icon={TrendingDown}
        subtitle="> 12 meses sin comprar"
        tone={(lost?.customers ?? 0) > 0 ? "danger" : "default"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Reactivación (RFM) — segmentos AT_RISK, NEED_ATTENTION, HIBERNATING
// ──────────────────────────────────────────────────────────────────────────
function priorityBadge(score: number) {
  if (score >= 80)
    return (
      <Badge variant="danger" className="font-mono text-[10px]">
        {score}
      </Badge>
    );
  if (score >= 50)
    return (
      <Badge variant="warning" className="font-mono text-[10px]">
        {score}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {score}
    </Badge>
  );
}

const segmentVariant: Record<string, "danger" | "warning" | "secondary"> = {
  AT_RISK: "danger",
  NEED_ATTENTION: "warning",
  HIBERNATING: "warning",
  LOST: "secondary",
};

const rfmColumns: DataTableColumn<RfmSegmentRow>[] = [
  {
    key: "company",
    header: "Empresa",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
    ),
  },
  {
    key: "segment",
    header: "Segmento",
    cell: (r) => (
      <Badge
        variant={segmentVariant[r.segment] ?? "secondary"}
        className="text-[10px] uppercase"
      >
        {r.segment.replace("_", " ")}
      </Badge>
    ),
  },
  {
    key: "priority",
    header: "Prio",
    sortable: true,
    cell: (r) => priorityBadge(r.contact_priority_score),
    align: "center",
  },
  {
    key: "recency",
    header: "Días sin comprar",
    sortable: true,
    cell: (r) => (
      <span
        className={
          r.recency_days > 120
            ? "font-semibold text-danger tabular-nums"
            : "tabular-nums"
        }
      >
        {r.recency_days}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "frequency",
    header: "# compras",
    sortable: true,
    cell: (r) => <span className="tabular-nums">{r.frequency}</span>,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "monetary",
    header: "Revenue 12m",
    sortable: true,
    cell: (r) => <Currency amount={r.monetary_12m} compact />,
    align: "right",
  },
  {
    key: "last_purchase",
    header: "Última",
    cell: (r) => <DateDisplay date={r.last_purchase} relative />,
    hideOnMobile: true,
  },
];

async function ReactivacionSection() {
  const [atRisk, needAtt, hibernating] = await Promise.all([
    getRfmSegments("AT_RISK", 100),
    getRfmSegments("NEED_ATTENTION", 100),
    getRfmSegments("HIBERNATING", 100),
  ]);
  const all = [...atRisk, ...needAtt, ...hibernating]
    .filter((r) => r.monetary_12m > 0)
    .sort((a, b) => b.contact_priority_score - a.contact_priority_score)
    .slice(0, 25);

  if (all.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin clientes en riesgo"
        description="Todos tus clientes están activos."
        compact
      />
    );
  }

  return (
    <DataTable
      data={all}
      columns={rfmColumns}
      rowKey={(r) => String(r.company_id)}
      rowHref={(r) => `/companies/${r.company_id}`}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              truncate
            />
          }
          subtitle={r.segment.replace("_", " ")}
          badge={priorityBadge(r.contact_priority_score)}
          fields={[
            { label: "Días sin comprar", value: r.recency_days },
            {
              label: "Revenue 12m",
              value: <Currency amount={r.monetary_12m} compact />,
            },
          ]}
        />
      )}
    />
  );
}

const companyViewColumns = [
  { key: "company", label: "Empresa", alwaysVisible: true },
  { key: "status", label: "Estado" },
  { key: "revenue", label: "Revenue total" },
  { key: "revenue_90d", label: "Revenue 90d" },
  { key: "trend", label: "Tendencia" },
  { key: "overdue", label: "Vencido" },
  { key: "max_days", label: "Máx días vencido", defaultHidden: true },
  { key: "otd", label: "OTD %", defaultHidden: true },
  { key: "last_order", label: "Último pedido" },
  { key: "churn_risk", label: "Churn risk", defaultHidden: true },
];

const columns: DataTableColumn<CompanyListRow>[] = [
  {
    key: "company",
    header: "Empresa",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.name}
        tier={(r.pareto_class as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) =>
      r.customer_status ? (
        <Badge
          variant={statusVariant[r.customer_status] ?? "secondary"}
          className="uppercase text-[10px]"
        >
          {statusLabel[r.customer_status] ?? r.customer_status}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "revenue",
    header: "Revenue total",
    sortable: true,
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "revenue_90d",
    header: "Revenue 90d",
    sortable: true,
    cell: (r) => <Currency amount={r.revenue_90d} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "trend",
    header: "Tendencia",
    sortable: true,
    cell: (r) =>
      r.trend_pct !== 0 ? (
        <TrendIndicator value={r.trend_pct} good="up" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
  },
  {
    key: "overdue",
    header: "Vencido",
    sortable: true,
    cell: (r) =>
      r.overdue_amount > 0 ? (
        <span className="text-danger tabular-nums">
          <Currency amount={r.overdue_amount} compact />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "max_days",
    header: "Máx días",
    defaultHidden: true,
    cell: (r) =>
      r.max_days_overdue != null ? (
        <span className="font-semibold tabular-nums text-danger">
          {r.max_days_overdue}d
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "otd",
    header: "OTD %",
    defaultHidden: true,
    cell: (r) =>
      r.otd_rate != null ? (
        <span className="tabular-nums">{Math.round(r.otd_rate)}%</span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "last_order",
    header: "Último pedido",
    sortable: true,
    cell: (r) => <DateDisplay date={r.last_order_date} relative />,
    hideOnMobile: true,
  },
  {
    key: "churn_risk",
    header: "Churn risk",
    defaultHidden: true,
    cell: (r) =>
      r.churn_risk_score != null ? (
        <span
          className={`tabular-nums ${
            r.churn_risk_score >= 70
              ? "text-danger font-semibold"
              : r.churn_risk_score >= 40
                ? "text-warning"
                : ""
          }`}
        >
          {Math.round(r.churn_risk_score)}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
];

async function CompaniesTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    facetKeys: ["tier", "risk"],
    defaultSize: 25,
    defaultSort: "-revenue",
  });
  const { rows, total } = await getCompaniesPage({
    ...params,
    tier: params.facets.tier,
    risk: params.facets.risk,
  });
  const visibleKeys = parseVisibleKeys(searchParams);
  const sortHref = makeSortHref({
    pathname: "/companies",
    searchParams,
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Sin empresas"
        description="Ajusta tus filtros — no hay resultados."
      />
    );
  }

  return (
    <>
      <Card>
        <CardContent className="grid grid-cols-3 gap-3 py-3 text-center sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Empresas (filtradas)
            </div>
            <div className="text-lg font-bold tabular-nums">
              {total.toLocaleString("es-MX")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Pareto A (página)
            </div>
            <div className="text-lg font-bold tabular-nums text-success">
              {rows.filter((r) => r.pareto_class === "A").length}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              En riesgo (página)
            </div>
            <div className="text-lg font-bold tabular-nums text-danger">
              {rows.filter((r) => r.customer_status === "at_risk").length}
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Con vencido (página)
            </div>
            <div className="text-lg font-bold tabular-nums text-warning">
              {rows.filter((r) => r.overdue_amount > 0).length}
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.company_id)}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        rowHref={(r) => `/companies/${r.company_id}`}
        mobileCard={(r) => (
          <MobileCard
            title={
              <CompanyLink
                companyId={r.company_id}
                name={r.name}
                tier={(r.pareto_class as "A" | "B" | "C") ?? undefined}
                truncate
              />
            }
            subtitle={
              r.customer_status
                ? statusLabel[r.customer_status] ?? r.customer_status
                : undefined
            }
            badge={
              r.overdue_amount > 0 ? (
                <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger-foreground">
                  <Currency amount={r.overdue_amount} compact />
                </span>
              ) : undefined
            }
            fields={[
              {
                label: "Revenue",
                value: <Currency amount={r.total_revenue} compact />,
              },
              {
                label: "90d",
                value: <Currency amount={r.revenue_90d} compact />,
              },
              {
                label: "Trend",
                value:
                  r.trend_pct !== 0 ? (
                    <TrendIndicator value={r.trend_pct} good="up" />
                  ) : (
                    "—"
                  ),
              },
              {
                label: "Último",
                value: <DateDisplay date={r.last_order_date} relative />,
              },
            ]}
          />
        )}
      />
      <DataTablePagination
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="empresas"
      />
    </>
  );
}
