import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  ChevronRight,
  Factory,
  Flame,
  Inbox,
  Target,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  EmptyState,
  CompanyLink,
  Currency,
  DateDisplay,
  SeverityBadge,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getDashboardKpis,
  getTopAtRiskClients,
  getRevenueTrend,
} from "@/lib/queries/analytics/dashboard";
import { getInsights, isVisibleToCEO } from "@/lib/queries/intelligence/insights";
import {
  getActiveTripwires,
  type ConcentrationRow,
  type ConcentrationTripwire,
} from "@/lib/queries/analytics";
import { formatCurrencyMXN, formatRelative } from "@/lib/formatters";

import { RevenueTrendChart } from "./_components/revenue-trend-chart";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "CEO Dashboard" };

function greet() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function CeoDashboardPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title={greet()}
        subtitle="Lo que necesitas saber del negocio en 30 segundos"
      />

      {/* Runway alert — la señal más crítica */}
      <Suspense fallback={<Skeleton className="h-20 rounded-xl" />}>
        <RunwayBanner />
      </Suspense>

      {/* Concentration tripwires — clientes top con caída brusca */}
      <Suspense fallback={null}>
        <ConcentrationTripwires />
      </Suspense>

      <Suspense fallback={<KpisSkeleton />}>
        <Kpis />
      </Suspense>

      {/* Insights urgentes — spec: "lista de insights urgentes abajo" */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Insights urgentes
          </h2>
          <Link
            href="/inbox"
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            Ver todos
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <Suspense fallback={<InsightsSkeleton />}>
          <UrgentInsights />
        </Suspense>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ingresos últimos 12 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={<Skeleton className="h-[220px] w-full rounded-md" />}
            >
              <RevenueChartSection />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clientes en riesgo</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<InsightsSkeleton rows={5} />}>
              <AtRiskClientsPanel />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Runway banner — lo primero que ve el CEO
// ──────────────────────────────────────────────────────────────────────────
async function RunwayBanner() {
  const k = await getDashboardKpis();
  if (!k) return null;
  const days = k.cash.runway_days;
  const tone =
    days <= 7 ? "danger" : days <= 30 ? "warning" : "success";
  const toneClass = {
    danger: "border-l-danger bg-danger/10",
    warning: "border-l-warning bg-warning/10",
    success: "border-l-success bg-success/10",
  }[tone];
  const iconColor = {
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
  }[tone];

  return (
    <Link href="/finanzas" className="block">
      <Card
        className={`gap-2 border-l-4 transition-colors active:bg-accent/60 ${toneClass}`}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <Flame className={`h-6 w-6 shrink-0 ${iconColor}`} aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tabular-nums ${iconColor}`}>
                {days}
              </span>
              <span className="text-sm font-medium">días de runway</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Cash total{" "}
              <Currency amount={k.cash.total_mxn} compact colorBySign /> ·{" "}
              <Currency amount={k.cash.cash_mxn} compact /> MXN ·{" "}
              <Currency amount={k.cash.cash_usd} compact /> USD
            </p>
          </div>
          <ChevronRight
            className="h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>
      </Card>
    </Link>
  );
}

function KpisSkeleton() {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[96px] rounded-xl" />
      ))}
    </StatGrid>
  );
}

function InsightsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

async function Kpis() {
  const k = await getDashboardKpis();
  if (!k) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin datos del dashboard"
        description="get_dashboard_kpis() no devolvió resultados."
      />
    );
  }

  const momPct =
    k.revenue.last_month > 0
      ? ((k.revenue.this_month - k.revenue.last_month) / k.revenue.last_month) *
        100
      : 0;

  return (
    <>
      <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
        <KpiCard
          title="Ingresos del mes"
          value={k.revenue.this_month}
          format="currency"
          compact
          icon={TrendingUp}
          trend={{ value: momPct, good: "up" }}
          subtitle={`YTD ${formatCurrencyMXN(k.revenue.ytd, { compact: true })}`}
          tone={momPct >= 0 ? "success" : "warning"}
          href="/ventas"
        />
        <KpiCard
          title="Cartera vencida"
          value={k.collections.total_overdue_mxn}
          format="currency"
          compact
          icon={AlertTriangle}
          subtitle={`${k.collections.overdue_count} facturas · ${formatCurrencyMXN(
            k.collections.expected_collections_30d,
            { compact: true }
          )} esperado 30d`}
          tone="danger"
          href="/cobranza"
        />
        <KpiCard
          title="Reorden en riesgo"
          value={k.predictions.reorders_at_risk_mxn}
          format="currency"
          compact
          icon={Target}
          subtitle={`${k.predictions.reorders_overdue} vencidos · ${k.predictions.reorders_lost} perdidos`}
          tone={k.predictions.reorders_overdue > 0 ? "warning" : "default"}
          href="/ventas"
        />
        <KpiCard
          title="Insights urgentes"
          value={k.insights.urgent_count}
          format="number"
          icon={Inbox}
          subtitle={
            k.insights.new_count > 0
              ? `${k.insights.new_count} nuevos · ${k.insights.acceptance_rate.toFixed(0)}% aceptados`
              : `${k.insights.acceptance_rate.toFixed(0)}% aceptados`
          }
          tone={k.insights.urgent_count > 0 ? "danger" : "default"}
          href="/inbox"
        />
        <KpiCard
          title="OTD rate"
          value={k.operations.otd_rate}
          format="percent"
          icon={Truck}
          subtitle={`${k.operations.late_deliveries} tarde · ${k.operations.pending_deliveries} pendientes`}
          tone={
            k.operations.otd_rate == null
              ? "default"
              : k.operations.otd_rate >= 90
                ? "success"
                : k.operations.otd_rate >= 75
                  ? "warning"
                  : "danger"
          }
          href="/operaciones"
        />
        <KpiCard
          title="Manufactura"
          value={k.operations.manufacturing_active}
          format="number"
          icon={Factory}
          subtitle={`${k.operations.overdue_activities} actividades vencidas`}
          tone={k.operations.overdue_activities > 100 ? "warning" : "default"}
          href="/operaciones"
        />
      </StatGrid>
      <p className="text-[11px] text-muted-foreground">
        Actualizado {formatRelative(k.generated_at)}
      </p>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Concentration tripwires — Top customers con caída brusca
// ──────────────────────────────────────────────────────────────────────────
const tripwireLabel: Record<ConcentrationTripwire, string> = {
  TOP5_DECLINE_25PCT: "Top 5 cayó −25% MoM",
  TOP10_DECLINE_40PCT: "Top 10 cayó −40% MoM",
  TOP5_NO_ORDER_45D: "Top 5 sin facturar 45+ días",
};

function tripwireMessage(t: ConcentrationRow): string {
  switch (t.tripwire) {
    case "TOP5_DECLINE_25PCT":
      return `${t.rev_30d_delta_pct?.toFixed(0)}% MoM · ${t.share_pct.toFixed(1)}% del revenue`;
    case "TOP10_DECLINE_40PCT":
      return `${t.rev_30d_delta_pct?.toFixed(0)}% MoM · #${t.rank_in_portfolio}`;
    case "TOP5_NO_ORDER_45D":
      return `${t.days_since_last_invoice}d sin facturar · ${t.share_pct.toFixed(1)}% del revenue`;
    default:
      return "";
  }
}

async function ConcentrationTripwires() {
  const tripwires = await getActiveTripwires();
  if (tripwires.length === 0) return null;

  return (
    <Card className="gap-2 border-l-4 border-l-warning bg-warning/5">
      <CardHeader className="px-4 pt-3 pb-1">
        <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Tripwires de concentración ({tripwires.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4">
        {tripwires.map((t) => (
          <Link
            key={t.company_id}
            href={`/companies/${t.company_id}`}
            className="block rounded-lg border bg-card p-3 transition-colors active:bg-accent/60"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-muted-foreground">
                    #{t.rank_in_portfolio}
                  </span>
                  <span className="truncate text-sm font-semibold">
                    {t.company_name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <span className="font-semibold uppercase tracking-wide text-warning">
                    {t.tripwire ? tripwireLabel[t.tripwire] : ""}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {tripwireMessage(t)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <Currency amount={t.rev_12m} compact />
                <div className="text-[9px] uppercase text-muted-foreground">
                  rev 12m
                </div>
              </div>
              <ChevronRight
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

async function RevenueChartSection() {
  const data = await getRevenueTrend(12);
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos de ingresos"
        description="No hay periodos válidos en pl_estado_resultados."
        compact
      />
    );
  }
  return <RevenueTrendChart data={data} />;
}

async function UrgentInsights() {
  const insights = await getInsights({ state: "new", limit: 20 });
  const urgent = insights
    .filter(isVisibleToCEO) // hide low-impact cobranza — audit 2026-04-15
    .filter((i) => i.severity === "critical" || i.severity === "high")
    .slice(0, 5);

  if (urgent.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Sin insights urgentes"
        description="No hay insights críticos ni de alta severidad pendientes."
        compact
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {urgent.map((i) => (
        <Link key={i.id} href={`/inbox/insight/${i.id}`} className="block">
          <Card className="gap-1 py-3 transition-colors active:bg-accent/50">
            <div className="flex items-start justify-between gap-2 px-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <SeverityBadge level={i.severity ?? "medium"} pulse />
                  {i.category && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {i.category}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm font-semibold">
                  {i.title ?? "—"}
                </div>
                {i.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {i.description}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {i.company_name && (
                    <span className="truncate">{i.company_name}</span>
                  )}
                  {i.assignee_name && (
                    <>
                      {i.company_name && <span>·</span>}
                      <span className="truncate">{i.assignee_name}</span>
                    </>
                  )}
                  {i.created_at && (
                    <>
                      <span>·</span>
                      <DateDisplay date={i.created_at} relative />
                    </>
                  )}
                </div>
              </div>
              <ChevronRight
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function AtRiskClientsPanel() {
  const [k, clients] = await Promise.all([
    getDashboardKpis(),
    getTopAtRiskClients(5),
  ]);
  const totalAtRisk = k?.collections.clients_at_risk ?? 0;

  if (clients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin clientes en riesgo"
        description={`${totalAtRisk} clientes con churn score elevado`}
        compact
      />
    );
  }
  return (
    <div className="flex flex-col">
      {clients.map((c, i) => (
        <div
          key={`${c.company_id}-${i}`}
          className="space-y-1 border-b border-border/60 py-2 last:border-b-0"
        >
          <CompanyLink
            companyId={c.company_id ?? 0}
            name={c.company_name}
            tier={(c.tier as "A" | "B" | "C") ?? undefined}
            truncate
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              LTV: <Currency amount={c.ltv_mxn} compact />
            </span>
            <span>Churn: {c.churn_risk_score ?? 0}</span>
          </div>
          {c.max_days_overdue != null && c.max_days_overdue > 0 && (
            <div className="text-[11px] text-danger">
              Máx vencido: {c.max_days_overdue} días
            </div>
          )}
        </div>
      ))}
      {totalAtRisk > clients.length && (
        <Link
          href="/empresas"
          className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-primary"
        >
          Ver los {totalAtRisk} clientes en riesgo
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
