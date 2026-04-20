import { Suspense } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  Flame,
  Minus,
  TrendingDown,
  TrendingUp,
  Users,
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
  SectionNav,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  EmptyState,
  makeSortHref,
  type DataTableColumn,
  type DataViewChartSpec,
  type DataViewMode,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyMXN } from "@/lib/formatters";

import { PaymentRiskBatchActions } from "./_components/payment-risk-batch-actions";
import {
  getArAging,
  getCompanyAgingPage,
  getOverdueInvoicesPage,
  getOverdueSalespeopleOptions,
  getPaymentPredictionsPage,
  getPaymentRiskKpis,
  type CompanyAgingRow,
  type OverdueInvoice,
  type PaymentPredictionRow,
} from "@/lib/queries/unified/invoices";
import { getUnifiedRefreshStaleness } from "@/lib/queries/unified";
import { SatBadge } from "@/components/patterns/sat-badge";
import { RefreshStalenessBadge } from "@/components/patterns/refresh-staleness-badge";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { getCfoSnapshot } from "@/lib/queries/analytics/finance";
import {
  getCollectionEffectiveness,
  type CeiHealth,
  type CeiRow,
} from "@/lib/queries/analytics";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/_shared/table-params";

export const revalidate = 60; // 60s ISR cache · data freshness OK (pg_cron 15min)
export const metadata = { title: "Cobranza" };

type SearchParams = Record<string, string | string[] | undefined>;

function buildCobranzaHref(
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
  return s ? `/cobranza?${s}` : "/cobranza";
}

function parseViewParam(sp: SearchParams, key: string): DataViewMode {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "chart" ? "chart" : "table";
}

export default async function CobranzaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const staleness = await getUnifiedRefreshStaleness();
  return (
    <PageLayout>
      <PageHeader
        title="Cobranza"
        subtitle="¿Quién me debe, cuánto, y quién va a pagar mal?"
        actions={
          <DataSourceBadge source="unified" coverage="Odoo operativo + SAT validado" refresh="15min" />
        }
      />

      <RefreshStalenessBadge
        minutesSinceRefresh={staleness.minutesSinceRefresh}
        invoicesRefreshedAt={staleness.invoicesRefreshedAt}
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "cei", label: "CEI" },
          { id: "buckets", label: "Aging buckets" },
          { id: "payment-risk", label: "Riesgo de pago" },
          { id: "company-aging", label: "Cartera por cliente" },
          { id: "overdue", label: "Facturas vencidas" },
        ]}
      />

      {/* Hero KPIs */}
      <section id="kpis" className="scroll-mt-24 space-y-4">
      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <CobranzaHeroKpis />
      </Suspense>
      </section>

      {/* Collection Effectiveness Index */}
      <section id="cei" className="scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Collection Effectiveness Index (CEI)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            % del facturado cobrado por cohort mensual. Detecta degradación
            antes que llegue al aging bucket.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            }
          >
            <CeiTimeline />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Aging buckets */}
      <section id="buckets" className="scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aging buckets</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[80px] rounded-xl" />
                ))}
              </StatGrid>
            }
          >
            <AgingBuckets />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Payment risk */}
      <section id="payment-risk" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Clientes con patrón anormal de pago
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Detectado por `payment_predictions`. Filtra por riesgo o
              tendencia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="pr_"
              columns={paymentRiskViewColumns}
            />
            <TableExportButton filename="payment-risk" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="pr_"
            searchPlaceholder="Buscar cliente…"
            facets={[
              {
                key: "risk",
                label: "Riesgo",
                options: [
                  { value: "CRITICO", label: "Crítico" },
                  { value: "ALTO", label: "Alto" },
                  { value: "MEDIO", label: "Medio" },
                ],
              },
              {
                key: "trend",
                label: "Tendencia",
                options: [
                  { value: "empeorando", label: "Empeorando" },
                  { value: "estable", label: "Estable" },
                  { value: "mejorando", label: "Mejorando" },
                ],
              },
            ]}
          />
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <PaymentRiskTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Companies with aging */}
      <section id="company-aging" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Clientes con cartera vencida
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Buckets de aging por empresa. Busca por nombre o filtra por tier.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="age_"
              columns={companyAgingViewColumns}
            />
            <TableExportButton filename="company-aging" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <DataTableToolbar
            paramPrefix="age_"
            searchPlaceholder="Buscar cliente…"
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
            ]}
          />
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <CompanyAgingTable searchParams={sp} />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      {/* Overdue invoices */}
      <section id="overdue" className="scroll-mt-24">
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Facturas vencidas</CardTitle>
            <p className="text-xs text-muted-foreground">
              Busca por número, filtra por vendedor, bucket de aging o rango de
              fecha de emisión.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TableViewOptions
              paramPrefix="inv_"
              columns={overdueInvoicesViewColumns}
            />
            <TableExportButton filename="overdue-invoices" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <Suspense fallback={null}>
            <OverdueTableToolbar />
          </Suspense>
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <OverdueTable searchParams={sp} />
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
async function CobranzaHeroKpis() {
  const [cfo, paymentRisk] = await Promise.all([
    getCfoSnapshot(),
    getPaymentRiskKpis(),
  ]);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Cartera vencida"
        value={cfo?.carteraVencida ?? 0}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${cfo?.clientesMorosos ?? 0} clientes morosos`}
        tone="danger"
      />
      <KpiCard
        title="Cuentas por cobrar"
        value={cfo?.cuentasPorCobrar ?? 0}
        format="currency"
        compact
        icon={FileText}
        subtitle="total AR"
      />
      <KpiCard
        title="Cobros 30d"
        value={cfo?.cobros30d ?? 0}
        format="currency"
        compact
        icon={Calendar}
        tone="success"
      />
      <KpiCard
        title="Riesgo crítico"
        value={paymentRisk.criticalPending}
        format="currency"
        compact
        icon={Flame}
        subtitle={`${paymentRisk.criticalCount} clientes`}
        tone={paymentRisk.criticalCount > 0 ? "danger" : "default"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Collection Effectiveness Index timeline
// ──────────────────────────────────────────────────────────────────────────
const ceiHealthVariant: Record<
  CeiHealth,
  "success" | "info" | "warning" | "critical" | "secondary"
> = {
  healthy: "success",
  watch: "info",
  at_risk: "warning",
  degraded: "critical",
  too_recent: "secondary",
};

const ceiHealthLabel: Record<CeiHealth, string> = {
  healthy: "Saludable",
  watch: "Vigilar",
  at_risk: "En riesgo",
  degraded: "Degradado",
  too_recent: "Reciente",
};

function ceiBarColor(health: CeiHealth): string {
  if (health === "degraded") return "bg-danger";
  if (health === "at_risk") return "bg-warning";
  if (health === "watch") return "bg-info";
  if (health === "healthy") return "bg-success";
  return "bg-muted-foreground/40";
}

function formatCohortMonth(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

async function CeiTimeline() {
  const rows = await getCollectionEffectiveness(12);
  // Excluir cohorts demasiado recientes (no son comparables)
  const useful = rows.filter((r) => r.cohort_age_months >= 2).slice(0, 8);

  if (useful.length === 0) {
    return (
      <EmptyState
        icon={TrendingDown}
        title="Sin datos de cohort"
        description="No hay suficientes meses cerrados para calcular CEI."
        compact
      />
    );
  }

  // KPI: usa el cohort más reciente útil (primer elemento) como KPI actual.
  const latest = useful[0];
  const latestPct = Math.max(0, Math.min(100, latest.cei_pct));
  const sparklineData = [...useful].reverse().map((r) => ({
    cohort: formatCohortMonth(r.cohort_month),
    pct: Math.max(0, Math.min(100, r.cei_pct)),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card>
        <CardContent className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            CEI último cohort
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{latestPct.toFixed(1)}%</span>
            <span className="text-xs text-muted-foreground">meta 95%</span>
          </div>
          <div className="mt-2">
            <Badge variant={ceiHealthVariant[latest.health_status]} className="text-[10px] uppercase">
              {ceiHealthLabel[latest.health_status]}
            </Badge>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatCohortMonth(latest.cohort_month)}
          </div>
          {/* Mini-sparkline of CEI trend across all useful cohorts */}
          <div className="mt-3">
            <DataViewChart
              data={sparklineData as unknown as Record<string, unknown>[]}
              chart={{
                type: "line",
                xKey: "cohort",
                series: [{ dataKey: "pct", label: "CEI", color: "var(--chart-2)" }],
                valueFormat: "percent",
                height: 70,
                referenceLine: { value: 95, axis: "y", color: "var(--muted-foreground)", label: "meta", strokeDasharray: "3 3" },
                showYAxis: false,
              }}
            />
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
      {useful.map((r: CeiRow) => {
        const pct = Math.min(100, Math.max(0, r.cei_pct));
        const delta = r.cei_delta_vs_prev;
        return (
          <Card
            key={r.cohort_month}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
          >
            {/* Mes */}
            <div className="w-14 shrink-0 font-mono text-xs uppercase tabular-nums text-muted-foreground">
              {formatCohortMonth(r.cohort_month)}
            </div>

            {/* Barra de CEI */}
            <div className="relative flex-1">
              <div className="h-6 w-full overflow-hidden rounded-md bg-muted/40">
                <div
                  className={`h-full ${ceiBarColor(r.health_status)} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* 95% target marker */}
              <div className="pointer-events-none absolute inset-y-0" style={{ left: "95%" }} aria-label="meta 95%">
                <div className="h-full w-0.5 bg-muted-foreground/60" />
              </div>
              <div className="absolute inset-0 flex items-center px-2">
                <span className="text-xs font-bold tabular-nums text-foreground mix-blend-difference text-white">
                  {r.cei_pct.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Delta */}
            <div className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums sm:block">
              {delta != null ? (
                <span
                  className={
                    delta < -5
                      ? "font-semibold text-danger"
                      : delta > 5
                        ? "font-semibold text-success"
                        : "text-muted-foreground"
                  }
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}pp
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>

            {/* Health badge */}
            <Badge
              variant={ceiHealthVariant[r.health_status]}
              className="shrink-0 text-[10px] uppercase"
            >
              {ceiHealthLabel[r.health_status]}
            </Badge>

            {/* Outstanding (desktop only) */}
            <div className="hidden w-24 shrink-0 text-right md:block">
              <Currency amount={r.outstanding_mxn} compact />
              <div className="text-[9px] uppercase text-muted-foreground">
                pendiente
              </div>
            </div>
          </Card>
        );
      })}

      <p className="pt-2 text-[10px] text-muted-foreground">
        Cohorts con &lt; 2 meses se omiten porque aún están en periodo normal
        de cobranza. Health: ≥95% saludable, 85-95% vigilar, 70-85% en riesgo,
        &lt;70% degradado.
      </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aging buckets
// ──────────────────────────────────────────────────────────────────────────
async function AgingBuckets() {
  const buckets = await getArAging();
  const iconMap: Record<string, typeof Calendar> = {
    "1-30": Calendar,
    "31-60": Calendar,
    "61-90": AlertTriangle,
    "91-120": AlertTriangle,
    "120+": TrendingDown,
  };
  const toneMap: Record<string, "info" | "warning" | "danger"> = {
    "1-30": "info",
    "31-60": "warning",
    "61-90": "warning",
    "91-120": "danger",
    "120+": "danger",
  };
  const total = buckets.reduce((s, b) => s + (b.amount_mxn ?? 0), 0);
  const agingBarData = [
    {
      label: "Cartera vencida",
      "1-30": buckets.find(b => b.bucket === "1-30")?.amount_mxn ?? 0,
      "31-60": buckets.find(b => b.bucket === "31-60")?.amount_mxn ?? 0,
      "61-90": buckets.find(b => b.bucket === "61-90")?.amount_mxn ?? 0,
      "91-120": buckets.find(b => b.bucket === "91-120")?.amount_mxn ?? 0,
      "120+": buckets.find(b => b.bucket === "120+")?.amount_mxn ?? 0,
    },
  ];
  const agingChart: DataViewChartSpec = {
    type: "bar",
    xKey: "label",
    stacked: true,
    layout: "horizontal",
    series: [
      { dataKey: "1-30", label: "1–30 días", color: "var(--chart-2)" },
      { dataKey: "31-60", label: "31–60 días", color: "var(--warning)" },
      { dataKey: "61-90", label: "61–90 días", color: "var(--chart-4)" },
      { dataKey: "91-120", label: "91–120 días", color: "var(--danger)" },
      { dataKey: "120+", label: "120+ días", color: "var(--destructive)" },
    ],
    valueFormat: "currency-compact",
    height: 90,
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Composición cartera vencida
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatCurrencyMXN(total, { compact: true })}
            </span>
          </div>
          <DataViewChart
            data={agingBarData as unknown as Record<string, unknown>[]}
            chart={agingChart}
          />
        </CardContent>
      </Card>
      <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 3 }}>
        {buckets.map((b) => (
          <KpiCard
            key={b.bucket}
            title={`${b.bucket} días`}
            value={b.amount_mxn}
            format="currency"
            compact
            icon={iconMap[b.bucket] ?? Calendar}
            subtitle={`${b.count} facturas`}
            tone={toneMap[b.bucket] ?? "info"}
            size="sm"
          />
        ))}
      </StatGrid>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Payment risk
// ──────────────────────────────────────────────────────────────────────────
function riskShortLabel(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITICO")) return "Crítico";
  if (upper.startsWith("ALTO")) return "Alto";
  if (upper.startsWith("MEDIO")) return "Medio";
  return raw;
}
function riskVariant(raw: string): "critical" | "warning" | "info" {
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITICO")) return "critical";
  if (upper.startsWith("ALTO")) return "warning";
  return "info";
}
function trendLabel(raw: string | null): string {
  if (!raw) return "—";
  const map: Record<string, string> = {
    estable: "Estable",
    mejorando: "Mejorando",
    empeorando: "Empeorando",
  };
  return map[raw] ?? raw;
}

const paymentRiskViewColumns = [
  { key: "company", label: "Cliente", alwaysVisible: true },
  { key: "risk", label: "Riesgo" },
  { key: "trend", label: "Tendencia" },
  { key: "avg_days", label: "Días promedio" },
  { key: "median_days", label: "Días mediana", defaultHidden: true },
  { key: "max_overdue", label: "Máx vencido" },
  { key: "pending_count", label: "# facturas", defaultHidden: true },
  { key: "pending", label: "Pendiente" },
];

const paymentColumns: DataTableColumn<PaymentPredictionRow>[] = [
  {
    key: "company",
    header: "Cliente",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name ? capitalize(r.company_name) : null}
        truncate
      />
    ),
  },
  {
    key: "risk",
    header: "Riesgo",
    cell: (r) => (
      <Badge variant={riskVariant(r.payment_risk)}>
        {riskShortLabel(r.payment_risk)}
      </Badge>
    ),
  },
  {
    key: "trend",
    header: "Tendencia",
    cell: (r) => {
      if (!r.payment_trend) return <span className="text-muted-foreground">—</span>;
      const trend = r.payment_trend;
      const Icon = trend === "mejorando" ? TrendingUp : trend === "empeorando" ? TrendingDown : Minus;
      const color = trend === "mejorando" ? "text-success" : trend === "empeorando" ? "text-danger" : "text-muted-foreground";
      const label = trendLabel(trend);
      return (
        <span className={`flex items-center gap-1 ${color}`} title={label} aria-label={label}>
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs">{label}</span>
        </span>
      );
    },
    hideOnMobile: true,
  },
  {
    key: "avg_days",
    header: "Días prom",
    sortable: true,
    cell: (r) =>
      r.avg_days_to_pay != null ? (
        <span className="tabular-nums">{Math.round(r.avg_days_to_pay)}</span>
      ) : (
        "—"
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "median_days",
    header: "Mediana",
    defaultHidden: true,
    cell: (r) =>
      r.median_days_to_pay != null ? (
        <span className="tabular-nums">{Math.round(r.median_days_to_pay)}</span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "max_overdue",
    header: "Máx vencido",
    sortable: true,
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
    key: "pending_count",
    header: "# facturas",
    defaultHidden: true,
    cell: (r) => <span className="tabular-nums">{r.pending_count}</span>,
    align: "right",
  },
  {
    key: "pending",
    header: "Pendiente",
    sortable: true,
    cell: (r) => (
      <span className="font-bold tabular-nums">
        <Currency amount={r.total_pending} compact />
      </span>
    ),
    align: "right",
    summary: (rows) => (
      <span className="font-bold text-danger">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_pending ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
];

function capitalize(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function PaymentRiskTable({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "pr_",
    facetKeys: ["risk", "trend"],
    defaultSize: 25,
    defaultSort: "-pending",
  });
  const { rows, total } = await getPaymentPredictionsPage({
    ...params,
    risk: params.facets.risk,
    trend: params.facets.trend,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "pr_");
  const sortHref = makeSortHref({
    pathname: "/cobranza",
    searchParams,
    paramPrefix: "pr_",
  });
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Flame}
        title="Sin clientes en riesgo"
        description="Todos los clientes pagan dentro de su patrón normal."
        compact
      />
    );
  }
  const view = parseViewParam(searchParams, "pr_view");
  // Rows pre-formatted with chart-friendly label + risk tier for colorBy.
  const chartRows = rows.map((r) => ({
    ...r,
    company_label: r.company_name ? capitalize(r.company_name) : "—",
    risk_tier: riskShortLabel(r.payment_risk),
  }));
  const chart: DataViewChartSpec = {
    type: "composed",
    xKey: "company_label",
    topN: 15,
    series: [
      {
        dataKey: "total_pending",
        label: "Pendiente",
        kind: "bar",
        yAxisId: "left",
      },
      {
        dataKey: "max_days_overdue",
        label: "Máx días vencido",
        kind: "line",
        yAxisId: "right",
        color: "var(--chart-4)",
      },
    ],
    valueFormat: "currency-compact",
    secondaryValueFormat: "number",
    colorBy: "risk_tier",
    colorMap: {
      "Crítico": "var(--destructive)",
      "Alto": "var(--chart-4)",
      "Medio": "var(--chart-3)",
    },
    rowHrefTemplate: "/empresas/{company_id}",
  };
  // Mapa id → nombre legible, para que el client component de batch actions
  // pueda construir nombres a partir de los IDs seleccionados sin re-fetch.
  const idToName: Record<string, string> = {};
  for (const r of chartRows) {
    idToName[String(r.company_id)] =
      r.company_name != null ? capitalize(r.company_name) : `#${r.company_id}`;
  }
  return (
    <>
    <DataView
      data={chartRows}
      columns={paymentColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildCobranzaHref(searchParams, {
          pr_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.company_id)}
      rowHref={(r) => `/companies/${r.company_id}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      selection={{ rowId: (r) => String(r.company_id) }}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name ? capitalize(r.company_name) : null}
              truncate
            />
          }
          subtitle={(() => {
            const trend = r.payment_trend;
            if (!trend) return "—";
            const Icon = trend === "mejorando" ? TrendingUp : trend === "empeorando" ? TrendingDown : Minus;
            const color = trend === "mejorando" ? "text-success" : trend === "empeorando" ? "text-danger" : "text-muted-foreground";
            const label = trendLabel(trend);
            return (
              <span className={`flex items-center gap-1 ${color}`} aria-label={label}>
                <Icon className="h-3.5 w-3.5" />
                <span className="text-xs">{label}</span>
              </span>
            );
          })()}
          badge={
            <Badge variant={riskVariant(r.payment_risk)}>
              {riskShortLabel(r.payment_risk)}
            </Badge>
          }
          fields={[
            {
              label: "Pendiente",
              value: <Currency amount={r.total_pending} compact />,
            },
            {
              label: "Máx vencido",
              value:
                r.max_days_overdue != null
                  ? `${r.max_days_overdue}d`
                  : "—",
              className: "text-danger",
            },
            {
              label: "Días promedio",
              value:
                r.avg_days_to_pay != null
                  ? Math.round(r.avg_days_to_pay)
                  : "—",
            },
            {
              label: "# facturas",
              value: r.pending_count,
            },
          ]}
        />
      )}
    >
      <PaymentRiskBatchActions idToName={idToName} />
    </DataView>
    {view === "table" && (
      <DataTablePagination
        paramPrefix="pr_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="clientes"
      />
    )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Company aging
// ──────────────────────────────────────────────────────────────────────────
const companyAgingViewColumns = [
  { key: "company", label: "Cliente", alwaysVisible: true },
  { key: "current", label: "Al corriente", defaultHidden: true },
  { key: "1_30", label: "1–30 días" },
  { key: "31_60", label: "31–60 días" },
  { key: "61_90", label: "61–90 días" },
  { key: "90plus", label: "90+ días" },
  { key: "total", label: "Total" },
  { key: "revenue", label: "Revenue 12m", defaultHidden: true },
];

const companyColumns: DataTableColumn<CompanyAgingRow>[] = [
  {
    key: "company",
    header: "Cliente",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name}
        tier={(r.tier as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "current",
    header: "Al día",
    defaultHidden: true,
    cell: (r) => <Currency amount={r.current_amount} compact />,
    align: "right",
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.current_amount ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "1_30",
    header: "1-30",
    sortable: true,
    cell: (r) => <Currency amount={r.overdue_1_30} compact />,
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.overdue_1_30 ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "31_60",
    header: "31-60",
    sortable: true,
    cell: (r) => <Currency amount={r.overdue_31_60} compact />,
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.overdue_31_60 ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "61_90",
    header: "61-90",
    sortable: true,
    cell: (r) => <Currency amount={r.overdue_61_90} compact />,
    align: "right",
    hideOnMobile: true,
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.overdue_61_90 ?? 0), 0)}
        compact
      />
    ),
  },
  {
    key: "90plus",
    header: "90+",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        <Currency amount={r.overdue_90plus} compact />
      </span>
    ),
    align: "right",
    summary: (rows) => (
      <span className="text-danger">
        <Currency
          amount={rows.reduce((s, r) => s + (r.overdue_90plus ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "total",
    header: "Total",
    sortable: true,
    cell: (r) => (
      <span className="font-bold tabular-nums">
        <Currency amount={r.total_receivable} compact />
      </span>
    ),
    align: "right",
    summary: (rows) => (
      <span className="font-bold">
        <Currency
          amount={rows.reduce((s, r) => s + (r.total_receivable ?? 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "revenue",
    header: "Revenue 12m",
    defaultHidden: true,
    sortable: true,
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
    summary: (rows) => (
      <Currency
        amount={rows.reduce((s, r) => s + (r.total_revenue ?? 0), 0)}
        compact
      />
    ),
  },
];

async function CompanyAgingTable({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "age_",
    facetKeys: ["tier"],
    defaultSize: 25,
    defaultSort: "-total",
  });
  const { rows, total } = await getCompanyAgingPage({
    ...params,
    tier: params.facets.tier,
  });
  const visibleKeys = parseVisibleKeys(searchParams, "age_");
  const sortHref = makeSortHref({
    pathname: "/cobranza",
    searchParams,
    paramPrefix: "age_",
  });
  const view = parseViewParam(searchParams, "age_view");
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "company_name",
    topN: 15,
    stacked: true,
    series: [
      { dataKey: "overdue_1_30", label: "1–30 d", color: "var(--chart-2)" },
      { dataKey: "overdue_31_60", label: "31–60 d", color: "var(--warning)" },
      { dataKey: "overdue_61_90", label: "61–90 d", color: "var(--danger)" },
      { dataKey: "overdue_90plus", label: "90+ d", color: "var(--destructive)" },
    ],
    valueFormat: "currency-compact",
  };
  return (
    <>
    <DataView
      data={rows}
      columns={companyColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildCobranzaHref(searchParams, {
          age_view: next === "chart" ? "chart" : null,
        })
      }
      rowKey={(r) => String(r.company_id)}
      rowHref={(r) => `/companies/${r.company_id}`}
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              tier={(r.tier as "A" | "B" | "C") ?? undefined}
              truncate
            />
          }
          badge={
            <Badge variant="danger" className="font-bold">
              <Currency amount={r.total_receivable} compact />
            </Badge>
          }
          fields={[
            {
              label: "1-30",
              value: <Currency amount={r.overdue_1_30} compact />,
            },
            {
              label: "31-60",
              value: <Currency amount={r.overdue_31_60} compact />,
            },
            {
              label: "61-90",
              value: <Currency amount={r.overdue_61_90} compact />,
            },
            {
              label: "90+",
              value: <Currency amount={r.overdue_90plus} compact />,
              className: "text-danger",
            },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin clientes con cartera vencida",
        description: "Todos los clientes están al corriente.",
      }}
    />
    {view === "table" && (
      <DataTablePagination
        paramPrefix="age_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="clientes"
      />
    )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue invoices
// ──────────────────────────────────────────────────────────────────────────
const invoiceColumns: DataTableColumn<OverdueInvoice>[] = [
  {
    key: "name",
    header: "Factura",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "company",
    header: "Cliente",
    cell: (r) =>
      r.company_id ? (
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
    key: "residual",
    header: "Saldo",
    sortable: true,
    cell: (r) => (
      <span className="tabular-nums font-semibold">
        <Currency amount={r.amount_residual_mxn} />
      </span>
    ),
    align: "right",
    summary: (rows) => {
      const total = rows.reduce(
        (s, r) => s + (Number(r.amount_residual_mxn) || 0),
        0
      );
      return <Currency amount={total} compact />;
    },
  },
  {
    key: "total",
    header: "Total factura",
    defaultHidden: true,
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
    summary: (rows) => {
      const total = rows.reduce(
        (s, r) => s + (Number(r.amount_total_mxn) || 0),
        0
      );
      return <Currency amount={total} compact />;
    },
  },
  {
    key: "days",
    header: "Días",
    sortable: true,
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        {r.days_overdue ?? 0}
      </span>
    ),
    align: "right",
    summary: (rows) => {
      if (rows.length === 0) return null;
      const avg = Math.round(
        rows.reduce((s, r) => s + (r.days_overdue ?? 0), 0) / rows.length
      );
      return (
        <span className="text-muted-foreground">
          prom. {avg}d
        </span>
      );
    },
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "invoice",
    header: "Emisión",
    defaultHidden: true,
    sortable: true,
    cell: (r) => <DateDisplay date={r.invoice_date} />,
  },
  {
    key: "due",
    header: "Vence",
    sortable: true,
    cell: (r) => <DateDisplay date={r.due_date} />,
    hideOnMobile: true,
  },
  {
    key: "sat",
    header: "SAT",
    defaultHidden: false,
    cell: (r) => (
      <SatBadge estadoSat={r.estado_sat} uuidSat={r.uuid_sat} />
    ),
    hideOnMobile: true,
  },
];

const overdueInvoicesViewColumns = [
  { key: "name", label: "Factura", alwaysVisible: true },
  { key: "company", label: "Cliente" },
  { key: "residual", label: "Saldo" },
  { key: "total", label: "Total factura", defaultHidden: true },
  { key: "days", label: "Días vencido" },
  { key: "salesperson", label: "Vendedor" },
  { key: "invoice", label: "Emisión", defaultHidden: true },
  { key: "due", label: "Vencimiento" },
  { key: "sat", label: "SAT" },
];

function bucketFromDays(days: number | null): string {
  const d = Number(days) || 0;
  if (d <= 0) return "current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  if (d <= 120) return "91-120";
  return "120+";
}

async function OverdueTableToolbar() {
  const salespeople = await getOverdueSalespeopleOptions();
  return (
    <DataTableToolbar
      paramPrefix="inv_"
      searchPlaceholder="Buscar factura…"
      dateRange={{ label: "Fecha factura" }}
      facets={[
        {
          key: "bucket",
          label: "Aging",
          options: [
            { value: "1-30", label: "1–30 días" },
            { value: "31-60", label: "31–60 días" },
            { value: "61-90", label: "61–90 días" },
            { value: "91-120", label: "91–120 días" },
            { value: "120+", label: "120+ días" },
          ],
        },
        {
          key: "salesperson",
          label: "Vendedor",
          options: salespeople.map((s) => ({ value: s, label: s })),
        },
      ]}
    />
  );
}

async function OverdueTable({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "inv_",
    facetKeys: ["bucket", "salesperson"],
    defaultSize: 25,
    defaultSort: "-amount",
  });
  const visibleKeys = parseVisibleKeys(searchParams, "inv_");
  const sortHref = makeSortHref({
    pathname: "/cobranza",
    searchParams,
    paramPrefix: "inv_",
  });
  const { rows, total } = await getOverdueInvoicesPage({
    ...params,
    bucket: params.facets.bucket,
    salesperson: params.facets.salesperson,
  });
  const view = parseViewParam(searchParams, "inv_view");
  const chartRows = rows.map((r) => ({
    ...r,
    bucket: bucketFromDays(r.days_overdue),
  }));
  const chart: DataViewChartSpec = {
    type: "bar",
    xKey: "name",
    topN: 15,
    series: [
      { dataKey: "amount_residual_mxn", label: "Saldo vencido", color: "var(--chart-1)" },
    ],
    valueFormat: "currency-compact",
    colorBy: "bucket",
    colorMap: {
      "1-30": "var(--chart-2)",
      "31-60": "var(--warning)",
      "61-90": "var(--danger)",
      "91-120": "var(--destructive)",
      "120+": "var(--destructive)",
    },
    height: 320,
  };
  return (
    <>
    <DataView
      data={chartRows}
      columns={invoiceColumns}
      chart={chart}
      view={view}
      viewHref={(next) =>
        buildCobranzaHref(searchParams, {
          inv_view: next === "chart" ? "chart" : null,
        })
      }
      sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
      sortHref={sortHref}
      visibleKeys={visibleKeys}
      stickyHeader
      rowKey={(r) => String(r.id)}
      rowHref={(r) =>
        r.company_id ? `/companies/${r.company_id}` : null
      }
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
              (r.company_name ?? "—")
            )
          }
          subtitle={r.name ?? undefined}
          badge={
            <Badge variant="danger" className="font-semibold">
              {r.days_overdue ?? 0}d
            </Badge>
          }
          fields={[
            {
              label: "Saldo",
              value: <Currency amount={r.amount_residual_mxn} />,
            },
            { label: "Vence", value: <DateDisplay date={r.due_date} /> },
            {
              label: "Bucket",
              value: bucketFromDays(r.days_overdue),
            },
            {
              label: "Vendedor",
              value: r.salesperson_name ?? "—",
              className: "col-span-2",
            },
          ]}
        />
      )}
      emptyState={{
        icon: FileText,
        title: "Sin cartera vencida",
        description: "Todas las facturas están al corriente.",
      }}
    />
    {view === "table" && (
      <DataTablePagination
        paramPrefix="inv_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="facturas"
      />
    )}
    </>
  );
}
