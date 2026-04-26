import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  Factory,
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
  QuestionSection,
  HistorySelector,
  DriftAlert,
  SectionNav,
  parseHistoryRange,
  type HistoryRange,
} from "@/components/patterns";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getDashboardKpis,
  getTopAtRiskClients,
  getRevenueTrend,
} from "@/lib/queries/analytics/dashboard";
import { getRunwayKpis } from "@/lib/queries/sp13/finanzas/runway";
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

interface HomeSearchParams {
  range?: string | string[];
}

export default async function CeoDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const range = parseHistoryRange(sp.range, "ltm");

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <PageHeader
        title={greet()}
        subtitle="¿Cuánto tengo, qué quema hoy y en qué debo enfocarme?"
        actions={<HistorySelector paramName="range" defaultRange="ltm" />}
      />

      {/* Banners arriba — runway + tripwires (cada uno se auto-oculta si no aplica) */}
      <Suspense fallback={null}>
        <RunwayAlertBanner />
      </Suspense>
      <Suspense fallback={null}>
        <ConcentrationTripwiresBanner />
      </Suspense>

      <SectionNav
        items={[
          { id: "resumen", label: "Resumen" },
          { id: "quema-hoy", label: "Qué quema hoy" },
          { id: "tendencia", label: "Tendencia" },
          { id: "en-riesgo", label: "En riesgo" },
        ]}
      />

      <QuestionSection
        id="resumen"
        question="¿Cómo está la salud del negocio?"
        subtext="6 KPIs core con deep-link a la página dedicada de cada dominio."
      >
        <Suspense fallback={<KpisSkeleton />}>
          <Kpis />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="quema-hoy"
        question="¿Qué quema hoy?"
        subtext="Top 5 insights críticos / altos visibles para el CEO (filtra cobranza low-impact)."
        actions={
          <Link
            href="/inbox"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver inbox completo →
          </Link>
        }
      >
        <Suspense fallback={<InsightsSkeleton />}>
          <UrgentInsights />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="tendencia"
        question="¿Cómo viene la facturación?"
        subtext={`Ingresos mensuales · ${rangeLabel(range)}.`}
      >
        <Suspense
          fallback={<Skeleton className="h-[240px] w-full rounded-md" />}
        >
          <RevenueChartSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="en-riesgo"
        question="¿Quién está en riesgo de irse?"
        subtext="Top 5 clientes con cartera vencida ordenados por monto. Click para ver ficha."
        actions={
          <Link
            href="/empresas/at-risk"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todos →
          </Link>
        }
      >
        <Suspense fallback={<InsightsSkeleton rows={5} />}>
          <AtRiskClientsPanel />
        </Suspense>
      </QuestionSection>
    </div>
  );
}

function rangeLabel(range: HistoryRange): string {
  switch (range) {
    case "mtd":
      return "Mes en curso";
    case "ytd":
      return "Año en curso";
    case "3y":
      return "Últ. 3 años";
    case "5y":
      return "Últ. 5 años";
    case "all":
      return "Todo el historial";
    case "ltm":
    default:
      return "Últ. 12 meses";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Runway alert banner — usa DriftAlert primitive en lugar de Card custom.
//
// Lee getRunwayKpis() canonical (gold_cashflow + gold_pl_statement) en
// lugar del RPC get_dashboard_kpis().cash.runway_days, que reportaba 0
// días incluso con net_income positivo y $3.4M en banco — bug del RPC.
// El helper de /finanzas calcula burn = avg(total_expense últimos 3 meses
// cerrados) / 30, runwayCashOnly = cash / burn, runwayWithAr =
// (cash + AR_abierto) / burn. Coherente con /finanzas.
// ──────────────────────────────────────────────────────────────────────────
async function RunwayAlertBanner() {
  const r = await getRunwayKpis();
  const days = r.runwayCashOnlyDays;
  if (days == null) return null;

  // Si runway cash-only > 60 días, no mostrar banner.
  if (days > 60) return null;

  const severity: "critical" | "warning" =
    days <= 7 ? "critical" : "warning";
  const title =
    days <= 0
      ? "Runway agotado"
      : `${days} día${days === 1 ? "" : "s"} de runway (cash-only)`;
  const burnLine = `Burn diario ${formatCurrencyMXN(r.burnRateDaily, { compact: true })} · ${r.burnWindow.monthsCovered}m de historia`;
  const arLine =
    r.runwayWithArDays != null && r.runwayWithArDays > days
      ? ` · Con AR cobrado: ${r.runwayWithArDays} días`
      : "";
  const description = `Cash ${formatCurrencyMXN(r.cashMxn, { compact: true })}. ${burnLine}.${arLine}`;

  return (
    <DriftAlert
      severity={severity}
      title={title}
      description={description}
      action={{ label: "Ver finanzas", href: "/finanzas" }}
    />
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

  // Comparar mes-en-curso (parcial) vs mes-anterior (cerrado) siempre da
  // MoM negativo durante los primeros días del mes — engañoso. Proyectar
  // el mes en curso a tasa diaria para que la comparación tenga sentido,
  // y etiquetar el subtitle como "(parcial)" para que el CEO sepa.
  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const isPartialMonth = dayOfMonth < daysInMonth;
  const projectedThisMonth = isPartialMonth
    ? (k.revenue.this_month / dayOfMonth) * daysInMonth
    : k.revenue.this_month;
  const momPct =
    k.revenue.last_month > 0
      ? ((projectedThisMonth - k.revenue.last_month) / k.revenue.last_month) *
        100
      : 0;
  const partialLabel = isPartialMonth
    ? ` · parcial (${dayOfMonth}/${daysInMonth}d)`
    : "";

  return (
    <div className="space-y-2">
      <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
        <KpiCard
          title="Ingresos del mes"
          value={k.revenue.this_month}
          format="currency"
          compact
          icon={TrendingUp}
          trend={{ value: momPct, good: "up" }}
          subtitle={`YTD ${formatCurrencyMXN(k.revenue.ytd, { compact: true })}${partialLabel}`}
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
          subtitle="Órdenes en proceso"
          href="/operaciones"
        />
      </StatGrid>
      <p className="text-[11px] text-muted-foreground">
        Actualizado {formatRelative(k.generated_at)}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Concentration tripwires — top customers con caída brusca o sin facturar.
// El backing view (revenue_concentration) está dropeado en SP1; el helper
// devuelve [] hasta que SP6 reimplemente con canonical_invoices. El banner
// se auto-oculta cuando no hay tripwires.
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

async function ConcentrationTripwiresBanner() {
  const tripwires = await getActiveTripwires();
  if (tripwires.length === 0) return null;

  const top = tripwires[0];
  const label = top.tripwire ? tripwireLabel[top.tripwire] : "Concentración";
  const headline =
    tripwires.length === 1
      ? `${top.company_name}: ${label}`
      : `${tripwires.length} clientes top con tripwires`;
  const description = tripwires
    .slice(0, 3)
    .map((t) => `${t.company_name} (${tripwireMessage(t)})`)
    .join(" · ");

  return (
    <DriftAlert
      severity="warning"
      title={headline}
      description={description}
      action={{
        label: tripwires.length === 1 ? "Ver empresa" : "Ver empresas",
        href:
          tripwires.length === 1
            ? `/empresas/${top.company_id}`
            : "/empresas/at-risk",
      }}
    />
  );
}

async function RevenueChartSection() {
  const data = await getRevenueTrend(12);
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos de ingresos"
        description="No hay periodos válidos en gold_revenue_monthly."
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
        description={
          totalAtRisk > 0
            ? `${totalAtRisk} con cartera vencida sin score por bucket`
            : "Toda la cartera al día."
        }
        compact
      />
    );
  }

  return (
    <div className="flex flex-col">
      {clients.map((c, i) => (
        <div
          key={`${c.canonical_company_id}-${i}`}
          className="space-y-1 border-b border-border/60 py-2 last:border-b-0"
        >
          <CompanyLink
            companyId={c.canonical_company_id}
            name={c.display_name}
            tier={(c.tier as "A" | "B" | "C") ?? undefined}
            truncate
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              LTV: <Currency amount={c.lifetime_value_mxn} compact />
            </span>
            <span>
              Vencido: <Currency amount={c.overdue_amount_mxn} compact />
            </span>
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
          href="/empresas/at-risk"
          className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-primary"
        >
          Ver los {totalAtRisk} clientes en riesgo
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
