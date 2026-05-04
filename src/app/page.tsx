import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Factory,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  EmptyState,
  CompanyLink,
  Currency,
  QuestionSection,
  HistorySelector,
  DriftAlert,
  SectionNav,
  parseHistoryRange,
  type HistoryRange,
} from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getDashboardKpis,
  getTopAtRiskClients,
} from "@/lib/queries/analytics/dashboard";
import { getRunwayKpis } from "@/lib/queries/sp13/finanzas/runway";
import {
  getActiveTripwires,
  type ConcentrationRow,
  type ConcentrationTripwire,
} from "@/lib/queries/analytics";
import { getTodayPulse, type PulseMetric } from "@/lib/queries/sp13/home/today-pulse";
import { getMonthToDate, type MtdMetric } from "@/lib/queries/sp13/home/month-to-date";
import {
  getOperationalRevenueTrend,
  getOperationalRevenueSnapshot,
} from "@/lib/queries/sp13/home/operational-revenue";
import { formatCurrencyMXN, formatNumber, formatRelative } from "@/lib/formatters";

import { RevenueTrendChart } from "./_components/revenue-trend-chart";

// searchParams (?range=) ya fuerza render dinámico; revalidate=60 deja a las
// queries cacheadas con unstable_cache servir desde caché entre requests.
export const revalidate = 60;
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
        subtitle="¿Qué pasó hoy y a dónde voy?"
        actions={<HistorySelector paramName="range" defaultRange="ltm" />}
      />

      <Suspense fallback={null}>
        <RunwayAlertBanner />
      </Suspense>
      <Suspense fallback={null}>
        <ConcentrationTripwiresBanner />
      </Suspense>

      <SectionNav
        items={[
          { id: "hoy", label: "Hoy" },
          { id: "mes", label: "Mes en curso" },
          { id: "traccion", label: "Tracción" },
          { id: "en-riesgo", label: "En riesgo" },
        ]}
      />

      <QuestionSection
        id="hoy"
        question="¿Qué pasó hoy?"
        subtext="Pulso operativo del día. Compara contra ayer."
      >
        <Suspense fallback={<KpisSkeleton count={4} />}>
          <TodaySection />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="mes"
        question="¿Cómo va el mes?"
        subtext="MTD vs mismo punto del mes pasado, con proyección lineal."
      >
        <Suspense fallback={<KpisSkeleton count={4} />}>
          <MonthToDateSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="traccion"
        question="¿Cómo viene la tracción?"
        subtext={`Ventas operativas (cuentas 401+402) — ${rangeLabel(range)}.`}
      >
        <Suspense
          fallback={<Skeleton className="h-[240px] w-full rounded-md" />}
        >
          <OperationalRevenueChartSection months={chartMonthsForRange(range)} />
        </Suspense>
        <div className="mt-4">
          <Suspense fallback={<KpisSkeleton count={4} />}>
            <HealthKpis />
          </Suspense>
        </div>
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

function chartMonthsForRange(range: HistoryRange): number {
  switch (range) {
    case "mtd":
    case "ytd":
      return 12;
    case "3y":
      return 36;
    case "5y":
      return 60;
    case "all":
      return 120;
    case "ltm":
    default:
      return 12;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Banners
// ──────────────────────────────────────────────────────────────────────────
async function RunwayAlertBanner() {
  const r = await getRunwayKpis();
  const days = r.runwayCashOnlyDays;
  if (days == null) return null;
  if (days > 60) return null;

  const severity: "critical" | "warning" = days <= 7 ? "critical" : "warning";
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

// ──────────────────────────────────────────────────────────────────────────
// Skeletons
// ──────────────────────────────────────────────────────────────────────────
function KpisSkeleton({ count }: { count: number }) {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 2, desktop: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[120px] rounded-xl" />
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

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function pulseTrend(metric: PulseMetric) {
  if (metric.deltaPct == null || !isFinite(metric.deltaPct)) return undefined;
  return {
    value: metric.deltaPct,
    good: "up" as const,
    direction:
      metric.today > metric.yesterday
        ? ("up" as const)
        : metric.today < metric.yesterday
          ? ("down" as const)
          : ("flat" as const),
  };
}

function mtdTrend(metric: MtdMetric) {
  if (metric.deltaPct == null || !isFinite(metric.deltaPct)) return undefined;
  return {
    value: metric.deltaPct,
    good: "up" as const,
    direction:
      metric.mtd > metric.lastMtd
        ? ("up" as const)
        : metric.mtd < metric.lastMtd
          ? ("down" as const)
          : ("flat" as const),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// HOY — pulso operativo del día
// ──────────────────────────────────────────────────────────────────────────
async function TodaySection() {
  const p = await getTodayPulse();

  return (
    <div className="space-y-2">
      <StatGrid columns={{ mobile: 2, tablet: 2, desktop: 4 }}>
        <KpiCard
          title="Vendí hoy"
          value={p.sales.today}
          format="currency"
          compact
          icon={TrendingUp}
          subtitle={
            p.sales.countToday > 0
              ? `${p.sales.countToday} factura${p.sales.countToday === 1 ? "" : "s"} · ayer ${formatCurrencyMXN(p.sales.yesterday, { compact: true })}`
              : `Ayer ${formatCurrencyMXN(p.sales.yesterday, { compact: true })} (${p.sales.countYesterday} fact)`
          }
          trend={pulseTrend(p.sales)}
          tone={p.sales.today > 0 ? "success" : "default"}
          href="/ventas"
        />
        <KpiCard
          title="Cobré últ. 7d"
          value={p.collections.last7d}
          format="currency"
          compact
          icon={ArrowDownLeft}
          subtitle={`${p.collections.countLast7d} pago${p.collections.countLast7d === 1 ? "" : "s"} · ayer ${formatCurrencyMXN(p.collections.yesterday, { compact: true })}`}
          tone={p.collections.last7d > 0 ? "success" : "default"}
          href="/cobranza"
        />
        <KpiCard
          title="Pagué últ. 7d"
          value={p.payments.last7d}
          format="currency"
          compact
          icon={ArrowUpRight}
          subtitle={`${p.payments.countLast7d} pago${p.payments.countLast7d === 1 ? "" : "s"} · ayer ${formatCurrencyMXN(p.payments.yesterday, { compact: true })}`}
          tone="default"
          href="/compras"
        />
        <KpiCard
          title="Fabriqué hoy"
          value={p.manufacturing.today}
          format="number"
          compact
          icon={Factory}
          subtitle={
            p.manufacturing.countToday > 0
              ? `${p.manufacturing.countToday} OF cerrada${p.manufacturing.countToday === 1 ? "" : "s"} · ayer ${formatNumber(p.manufacturing.yesterday, { compact: true })} u`
              : `Ayer ${formatNumber(p.manufacturing.yesterday, { compact: true })} u (${p.manufacturing.countYesterday} OFs)`
          }
          trend={pulseTrend(p.manufacturing)}
          tone={p.manufacturing.today > 0 ? "success" : "default"}
          href="/operaciones"
        />
      </StatGrid>
      <p className="text-[11px] text-muted-foreground">
        Actualizado {formatRelative(p.generatedAt)} · Ventas y manufactura: tiempo real · Cobranza y pagos: ventana 7d (canonical_payments tiene rezago de 1-3 días por matchers)
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MES EN CURSO
// ──────────────────────────────────────────────────────────────────────────
async function MonthToDateSection() {
  const m = await getMonthToDate();
  const partialLabel = `parcial (${m.dayOfMonth}/${m.daysInMonth}d)`;

  return (
    <div className="space-y-2">
      <StatGrid columns={{ mobile: 2, tablet: 2, desktop: 4 }}>
        <KpiCard
          title="Ventas MTD"
          value={m.sales.mtd}
          format="currency"
          compact
          icon={TrendingUp}
          subtitle={`${m.sales.countMtd} fact · proyectado ${formatCurrencyMXN(m.sales.projection, { compact: true })} · ${partialLabel}`}
          trend={mtdTrend(m.sales)}
          tone={
            m.sales.deltaPct == null || m.sales.deltaPct >= 0
              ? "success"
              : "warning"
          }
          href="/ventas"
        />
        <KpiCard
          title="Cobré MTD"
          value={m.collections.mtd}
          format="currency"
          compact
          icon={ArrowDownLeft}
          subtitle={`${m.collections.countMtd} pagos · proyectado ${formatCurrencyMXN(m.collections.projection, { compact: true })}`}
          trend={mtdTrend(m.collections)}
          tone={
            m.collections.deltaPct == null || m.collections.deltaPct >= 0
              ? "success"
              : "warning"
          }
          href="/cobranza"
        />
        <KpiCard
          title="Pagué MTD"
          value={m.payments.mtd}
          format="currency"
          compact
          icon={ArrowUpRight}
          subtitle={`${m.payments.countMtd} pagos · proyectado ${formatCurrencyMXN(m.payments.projection, { compact: true })}`}
          trend={mtdTrend(m.payments)}
          tone="default"
          href="/compras"
        />
        <KpiCard
          title="Fabriqué MTD"
          value={m.manufacturing.mtd}
          format="number"
          compact
          icon={Factory}
          subtitle={`${m.manufacturing.countMtd} OFs · proyectado ${formatNumber(m.manufacturing.projection, { compact: true })} u`}
          trend={mtdTrend(m.manufacturing)}
          tone={
            m.manufacturing.deltaPct == null || m.manufacturing.deltaPct >= 0
              ? "success"
              : "warning"
          }
          href="/operaciones"
        />
      </StatGrid>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// TRACCIÓN — chart de ventas operativas + 4 KPIs de salud
// ──────────────────────────────────────────────────────────────────────────
async function OperationalRevenueChartSection({ months }: { months: number }) {
  const data = await getOperationalRevenueTrend(months);
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos de ingresos operativos"
        description="No hay periodos en canonical_account_balances con cuentas 401/402."
        compact
      />
    );
  }
  return <RevenueTrendChart data={data} />;
}

async function HealthKpis() {
  const [k, runway, snap] = await Promise.all([
    getDashboardKpis(),
    getRunwayKpis(),
    getOperationalRevenueSnapshot(),
  ]);

  if (!k) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin datos del dashboard"
        description="get_dashboard_kpis() no devolvió resultados."
      />
    );
  }

  const ytdLabel = `YTD ${formatCurrencyMXN(snap.ytd, { compact: true })}`;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 2, desktop: 4 }}>
      <KpiCard
        title="Cash + Runway"
        value={runway.cashMxn}
        format="currency"
        compact
        icon={Wallet}
        subtitle={
          runway.runwayCashOnlyDays == null
            ? "Sin datos de burn"
            : `${runway.runwayCashOnlyDays}d cash-only · ${runway.runwayWithArDays ?? "—"}d con AR`
        }
        tone={
          runway.runwayCashOnlyDays == null
            ? "default"
            : runway.runwayCashOnlyDays <= 7
              ? "danger"
              : runway.runwayCashOnlyDays <= 60
                ? "warning"
                : "success"
        }
        href="/finanzas"
      />
      <KpiCard
        title="Cartera vencida"
        value={k.collections.total_overdue_mxn}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${k.collections.overdue_count} fact · ${formatCurrencyMXN(k.collections.expected_collections_30d, { compact: true })} esperado 30d`}
        tone="danger"
        href="/cobranza"
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
        title="Ventas operativas"
        value={snap.thisMonth}
        format="currency"
        compact
        icon={TrendingUp}
        subtitle={`Mes pasado ${formatCurrencyMXN(snap.lastMonth, { compact: true })} · ${ytdLabel}`}
        tone="default"
        href="/ventas"
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// At-risk clients panel — gold_company_360
// ──────────────────────────────────────────────────────────────────────────
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
