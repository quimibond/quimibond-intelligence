import { Suspense } from "react";
import { AlertTriangle, TrendingUp, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  KpiCard,
  StatGrid,
  DateDisplay,
  EmptyState,
  EvidencePackView,
} from "@/components/patterns";
import { SeverityBadge } from "@/components/patterns/severity-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { getCompanyEvidencePack } from "@/lib/queries/evidence";
import { getCustomer360, getCompanyInsights } from "@/lib/queries/customer-360";
import type { CompanyDetail } from "@/lib/queries/companies";

interface Props {
  company: CompanyDetail;
}

// ──────────────────────────────────────────────────────────────────────────
// KPI grid (from company detail — already fetched)
// ──────────────────────────────────────────────────────────────────────────
function PanoramaKpis({ company }: { company: CompanyDetail }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">KPIs clave</CardTitle>
          <DataSourceBadge source="odoo" refresh="1h" />
        </div>
      </CardHeader>
      <CardContent>
        <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 3 }}>
          <KpiCard
            title="Revenue 12m"
            value={company.revenue12m || company.totalRevenue}
            format="currency"
            compact
            icon={TrendingUp}
            trend={
              company.trendPct !== 0
                ? { value: company.trendPct, good: "up" }
                : undefined
            }
          />
          <KpiCard
            title="Cartera vencida"
            value={company.overdueAmount}
            format="currency"
            compact
            icon={AlertTriangle}
            subtitle={
              company.maxDaysOverdue
                ? `máx ${company.maxDaysOverdue} días`
                : "—"
            }
            tone={company.overdueAmount > 0 ? "danger" : "default"}
          />
          <KpiCard
            title="OTD"
            value={company.otdRate}
            format="percent"
            icon={Truck}
            subtitle={`${company.lateDeliveries} tardías`}
            tone={
              company.otdRate == null
                ? "default"
                : company.otdRate >= 90
                  ? "success"
                  : company.otdRate >= 75
                    ? "warning"
                    : "danger"
            }
          />
        </StatGrid>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Fiscal summary (from analytics_customer_360)
// ──────────────────────────────────────────────────────────────────────────
async function FiscalSummarySection({ companyId }: { companyId: number }) {
  const c360 = await getCustomer360(companyId);
  if (!c360) return null;

  const hasIssues =
    (c360.fiscal_issues_open ?? 0) > 0 ||
    (c360.fiscal_issues_critical ?? 0) > 0;
  const hasRate = c360.cancellation_rate != null;
  if (!hasIssues && !hasRate) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Resumen fiscal SAT</CardTitle>
          <DataSourceBadge source="syntage" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {hasIssues && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Issues de reconciliación</span>
            <div className="flex gap-2 items-center">
              {(c360.fiscal_issues_critical ?? 0) > 0 && (
                <SeverityBadge level="critical" />
              )}
              <span className="tabular-nums font-medium">
                {c360.fiscal_issues_open ?? 0} abiertos
              </span>
            </div>
          </div>
        )}
        {hasRate && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Tasa de cancelación</span>
            <span className="tabular-nums font-medium">
              {((c360.cancellation_rate ?? 0) * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {c360.last_cfdi && (
          <div className="flex items-center justify-between py-1.5 last:border-0">
            <span className="text-muted-foreground">Último CFDI</span>
            <DateDisplay date={c360.last_cfdi} relative />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// IA Insights (last 3 for this company)
// ──────────────────────────────────────────────────────────────────────────
async function InsightsSection({ companyId }: { companyId: number }) {
  const insights = await getCompanyInsights(companyId, 3);
  if (insights.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Insights IA recientes</CardTitle>
          <DataSourceBadge source="ia" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((ins) => (
          <div
            key={ins.id}
            className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium leading-snug">
                {ins.title ?? "—"}
              </span>
              {ins.severity && (
                <SeverityBadge level={ins.severity} />
              )}
            </div>
            {ins.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {ins.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              {ins.agent_name && (
                <span className="text-[10px] text-muted-foreground">
                  {ins.agent_name}
                </span>
              )}
              {ins.created_at && (
                <span className="text-[10px] text-muted-foreground">
                  · <DateDisplay date={ins.created_at} relative />
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Evidence pack (overview)
// ──────────────────────────────────────────────────────────────────────────
async function OverviewEvidenceSection({
  companyId,
}: {
  companyId: number;
}) {
  const pack = await getCompanyEvidencePack(companyId);
  if (!pack) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin evidence pack"
        description="No se pudo cargar el company_evidence_pack para esta empresa."
      />
    );
  }
  if (pack.is_self) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Esta es la propia Quimibond"
        description="Empresa interna. Las facturas y órdenes aquí son inter-company."
      />
    );
  }
  return <EvidencePackView pack={pack} />;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Panorama tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function PanoramaTab({ company }: Props) {
  return (
    <div className="space-y-4">
      <PanoramaKpis company={company} />
      <Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
        <FiscalSummarySection companyId={company.id} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
        <InsightsSection companyId={company.id} />
      </Suspense>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewEvidenceSection companyId={company.id} />
      </Suspense>
    </div>
  );
}
