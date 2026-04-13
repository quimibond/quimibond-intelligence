import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  ChevronRight,
  Inbox,
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
import { formatRelative } from "@/lib/formatters";

import { RevenueTrendChart } from "./_components/revenue-trend-chart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "CEO Dashboard",
};

function greet() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function CeoDashboardPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader title={greet()} subtitle="Panorama ejecutivo al minuto" />

      <Suspense fallback={<KpisSkeleton />}>
        <Kpis />
      </Suspense>

      {/* Spec: "lista de insights urgentes abajo" — prioridad mobile */}
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
            <CardTitle className="text-base">Revenue últimos 12 meses</CardTitle>
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
            <CardTitle className="text-base">Top clientes en riesgo</CardTitle>
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
  const kpis = await getDashboardKpis();

  return (
    <>
      <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
        <KpiCard
          title="Revenue del mes"
          value={kpis.revenueMonth}
          format="currency"
          compact
          icon={TrendingUp}
          trend={{ value: kpis.revenueTrendPct, good: "up" }}
          subtitle="vs mes anterior"
          tone={kpis.revenueTrendPct >= 0 ? "success" : "warning"}
          href="/ventas"
        />
        <KpiCard
          title="Cartera vencida"
          value={kpis.overdueTotalMxn}
          format="currency"
          compact
          icon={AlertTriangle}
          subtitle={`${kpis.overdueInvoiceCount} facturas`}
          tone="danger"
          href="/cobranza"
        />
        <KpiCard
          title="Cash position"
          value={kpis.cashPositionMxn}
          format="currency"
          compact
          icon={Banknote}
          subtitle="MXN en bancos"
          tone="info"
          href="/finanzas"
        />
        <KpiCard
          title="Insights nuevos"
          value={kpis.insightsNew}
          format="number"
          icon={Inbox}
          subtitle={
            kpis.insightsCritical > 0
              ? `${kpis.insightsCritical} críticos`
              : "sin críticos"
          }
          tone={kpis.insightsCritical > 0 ? "danger" : "default"}
          href="/inbox"
        />
        <KpiCard
          title="OTD rate"
          value={kpis.otdPct}
          format="percent"
          icon={Truck}
          subtitle="última semana"
          tone={
            kpis.otdPct == null
              ? "default"
              : kpis.otdPct >= 90
                ? "success"
                : kpis.otdPct >= 75
                  ? "warning"
                  : "danger"
          }
          href="/operaciones"
        />
        <KpiCard
          title="Clientes en riesgo"
          value={kpis.atRiskCount}
          format="number"
          icon={Users}
          subtitle="churn > 70, LTV > $100K"
          tone={kpis.atRiskCount > 0 ? "warning" : "default"}
          href="/companies"
        />
      </StatGrid>
      <p className="text-[11px] text-muted-foreground">
        Actualizado {formatRelative(kpis.lastUpdated)}
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
        title="Sin datos de revenue"
        description="No hay facturas registradas en los últimos 12 meses."
        compact
      />
    );
  }
  return <RevenueTrendChart data={data} />;
}

/**
 * Lista de insights urgentes (state=new, severity=critical o high).
 * WhatsApp-like list — tap para ir al detalle.
 */
async function UrgentInsights() {
  const insights = await getInsights({ state: "new", limit: 6 });
  // Filter client-side to prioritize critical + high
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
        <Link
          key={i.id}
          href={`/inbox/insight/${i.id}`}
          className="block"
        >
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
                  {i.company_id && i.company_name ? (
                    <span className="truncate">{i.company_name}</span>
                  ) : null}
                  {i.created_at && (
                    <>
                      {i.company_id && i.company_name ? <span>·</span> : null}
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
  const { topAtRiskClients } = await getDashboardKpis();
  if (topAtRiskClients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin clientes en riesgo"
        description="Todos los clientes tienen churn score aceptable."
        compact
      />
    );
  }
  return (
    <div className="flex flex-col">
      {topAtRiskClients.map((c, i) => (
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
    </div>
  );
}
