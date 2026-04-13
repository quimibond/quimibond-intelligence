import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  ChevronRight,
  Flame,
  Inbox,
  ShoppingCart,
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
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { getDashboardKpis, getRevenueTrend } from "@/lib/queries/dashboard";
import { getInsights } from "@/lib/queries/insights";
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
      <PageHeader title={greet()} subtitle="Panorama ejecutivo al minuto" />

      {/* Runway alert — la señal más crítica */}
      <Suspense fallback={<Skeleton className="h-20 rounded-xl" />}>
        <RunwayBanner />
      </Suspense>

      <Suspense fallback={<KpisSkeleton />}>
        <Kpis />
      </Suspense>

      {/* Spec: "lista de insights urgentes abajo" */}
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
              <AtRiskClients />
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
  const tone =
    k.runwayDias <= 7 ? "danger" : k.runwayDias <= 30 ? "warning" : "success";
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
      <Card className={`gap-2 border-l-4 transition-colors active:bg-accent/60 ${toneClass}`}>
        <div className="flex items-start gap-3 px-4 py-3">
          <Flame className={`h-6 w-6 shrink-0 ${iconColor}`} aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tabular-nums ${iconColor}`}>
                {k.runwayDias}
              </span>
              <span className="text-sm font-medium">días de runway</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Burn diario <Currency amount={k.burnDiario} compact /> · Efectivo
              neto <Currency amount={k.efectivoNeto} compact colorBySign />
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
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

  return (
    <>
      <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
        <KpiCard
          title="Ingresos del mes"
          value={k.ingresosMes}
          format="currency"
          compact
          icon={TrendingUp}
          trend={{ value: k.ingresosTrendPct, good: "up" }}
          subtitle="vs mes anterior"
          tone={k.ingresosTrendPct >= 0 ? "success" : "warning"}
          href="/ventas"
        />
        <KpiCard
          title="Cartera vencida"
          value={k.carteraVencida}
          format="currency"
          compact
          icon={AlertTriangle}
          subtitle={`${k.clientesMorosos} clientes morosos`}
          tone="danger"
          href="/cobranza"
        />
        <KpiCard
          title="Efectivo neto"
          value={k.efectivoNeto}
          format="currency"
          compact
          icon={Banknote}
          subtitle="efectivo − tarjetas"
          tone={k.efectivoNeto >= 0 ? "success" : "danger"}
          href="/finanzas"
        />
        <KpiCard
          title="Ventas 30d"
          value={k.ventas30d}
          format="currency"
          compact
          icon={ShoppingCart}
          subtitle={`Cobrado ${formatCurrencyMXN(k.cobros30d, { compact: true })}`}
          href="/ventas"
        />
        <KpiCard
          title="Insights nuevos"
          value={k.insightsNew}
          format="number"
          icon={Inbox}
          subtitle={
            k.insightsCritical > 0
              ? `${k.insightsCritical} críticos`
              : "sin críticos"
          }
          tone={k.insightsCritical > 0 ? "danger" : "default"}
          href="/inbox"
        />
        <KpiCard
          title="OTD rate"
          value={k.otdPct}
          format="percent"
          icon={Truck}
          subtitle="última semana"
          tone={
            k.otdPct == null
              ? "default"
              : k.otdPct >= 90
                ? "success"
                : k.otdPct >= 75
                  ? "warning"
                  : "danger"
          }
          href="/operaciones"
        />
      </StatGrid>
      <p className="text-[11px] text-muted-foreground">
        Actualizado {formatRelative(k.lastUpdated)}
      </p>
    </>
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
  const insights = await getInsights({ state: "new", limit: 10 });
  const urgent = insights
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
                  {i.created_at && (
                    <>
                      {i.company_name && <span>·</span>}
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

async function AtRiskClients() {
  const k = await getDashboardKpis();
  if (k.topAtRiskClients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin clientes en riesgo"
        description={`${k.atRiskCount} clientes con churn > 70 y LTV > 100K`}
        compact
      />
    );
  }
  return (
    <div className="flex flex-col">
      {k.topAtRiskClients.map((c, i) => (
        <div
          key={`${c.company_id}-${i}`}
          className="space-y-1 border-b border-border/60 py-2 last:border-b-0"
        >
          <CompanyLink
            companyId={c.company_id ?? 0}
            name={c.company_name}
            tier={c.tier ?? undefined}
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
      {k.atRiskCount > k.topAtRiskClients.length && (
        <Link
          href="/companies"
          className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-primary"
        >
          Ver los {k.atRiskCount} clientes en riesgo
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
