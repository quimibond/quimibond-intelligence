import { Suspense } from "react";
import {
  AlertTriangle,
  Banknote,
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
  MetricRow,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { getDashboardKpis, getRevenueTrend } from "@/lib/queries/dashboard";
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
      <PageHeader
        title={greet()}
        subtitle="Panorama ejecutivo al minuto"
      />

      <Suspense fallback={<KpisSkeleton />}>
        <Kpis />
      </Suspense>

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
            <Suspense
              fallback={
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              }
            >
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
          href="/insights"
        />
        <KpiCard
          title="OTD rate"
          value={kpis.otdPct != null ? kpis.otdPct : null}
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
          value={kpis.topAtRiskClients.length}
          format="number"
          icon={Users}
          subtitle="churn score > 60"
          tone={kpis.topAtRiskClients.length > 0 ? "warning" : "default"}
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
        <div key={`${c.company_id}-${i}`} className="space-y-1 border-b border-border/60 py-2 last:border-b-0">
          <CompanyLink
            companyId={c.company_id ?? 0}
            name={c.company_name}
            tier={c.tier ?? undefined}
            truncate
          />
          <MetricRow
            label="LTV"
            value={c.ltv_mxn ?? 0}
            format="currency"
            compact
            className="border-0 py-0.5 min-h-0"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Churn risk: {c.churn_risk_score ?? 0}</span>
            {c.max_days_overdue != null && (
              <span>
                Máx vencido:{" "}
                <Currency amount={c.max_days_overdue} format="number" /> días
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
