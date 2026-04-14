import { Suspense } from "react";
import { AlertTriangle, Phone, TrendingDown, Users } from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  DataTable,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getRfmSegments,
  getRfmSegmentSummary,
  type RfmSegmentRow,
} from "@/lib/queries/analytics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes en riesgo" };

function formatMxnCompact(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M MXN`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K MXN`;
  return `${Math.round(amount)} MXN`;
}

const segmentColor: Record<string, "critical" | "warning" | "secondary"> = {
  AT_RISK: "critical",
  NEED_ATTENTION: "warning",
  HIBERNATING: "warning",
  LOST: "secondary",
};

function priorityBadge(score: number) {
  if (score >= 80)
    return (
      <Badge variant="critical" className="font-mono text-[10px]">
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

const columns: DataTableColumn<RfmSegmentRow>[] = [
  {
    key: "company",
    header: "Empresa",
    cell: (r) => (
      <CompanyLink companyId={r.company_id} name={r.company_name} truncate />
    ),
  },
  {
    key: "priority",
    header: "Prio",
    cell: (r) => priorityBadge(r.contact_priority_score),
    align: "center",
  },
  {
    key: "recency",
    header: "Días sin comprar",
    cell: (r) => (
      <span
        className={
          r.recency_days > 120 ? "text-danger font-semibold" : "tabular-nums"
        }
      >
        {r.recency_days}
      </span>
    ),
    align: "right",
  },
  {
    key: "frequency",
    header: "Compras 2y",
    cell: (r) => <span className="tabular-nums">{r.frequency}</span>,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "monetary_12m",
    header: "Revenue 12m",
    cell: (r) => <Currency amount={r.monetary_12m} compact />,
    align: "right",
  },
  {
    key: "avg_ticket",
    header: "Ticket promedio",
    cell: (r) => <Currency amount={r.avg_ticket} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "outstanding",
    header: "Vencido",
    cell: (r) =>
      r.outstanding > 0 ? (
        <span className="text-warning">
          <Currency amount={r.outstanding} compact />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "last",
    header: "Última compra",
    cell: (r) => <DateDisplay date={r.last_purchase} relative />,
    hideOnMobile: true,
  },
];

export default function AtRiskCustomersPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Clientes en riesgo"
        subtitle="Reactivación dirigida — clientes con historial alto que llevan tiempo sin comprar"
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <AtRiskKpis />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        }
      >
        <AtRiskTable />
      </Suspense>
    </div>
  );
}

async function AtRiskKpis() {
  const summary = await getRfmSegmentSummary();
  const atRisk = summary.find((s) => s.segment === "AT_RISK");
  const needAtt = summary.find((s) => s.segment === "NEED_ATTENTION");
  const hibernating = summary.find((s) => s.segment === "HIBERNATING");
  const totalAtRiskRev =
    (atRisk?.revenue_12m ?? 0) +
    (needAtt?.revenue_12m ?? 0) +
    (hibernating?.revenue_12m ?? 0);
  const totalAtRiskCount =
    (atRisk?.customers ?? 0) +
    (needAtt?.customers ?? 0) +
    (hibernating?.customers ?? 0);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="AT RISK"
        value={atRisk?.customers ?? 0}
        subtitle={`${formatMxnCompact(atRisk?.revenue_12m ?? 0)} 12m`}
        icon={AlertTriangle}
        tone="danger"
      />
      <KpiCard
        title="Need Attention"
        value={needAtt?.customers ?? 0}
        subtitle={`${formatMxnCompact(needAtt?.revenue_12m ?? 0)} 12m`}
        icon={TrendingDown}
        tone="warning"
      />
      <KpiCard
        title="Hibernando"
        value={hibernating?.customers ?? 0}
        subtitle={`${formatMxnCompact(hibernating?.revenue_12m ?? 0)} 12m`}
        icon={Users}
        tone="warning"
      />
      <KpiCard
        title="Total reactivable"
        value={totalAtRiskCount}
        subtitle={`${formatMxnCompact(totalAtRiskRev)} en juego`}
        icon={Phone}
        tone="info"
      />
    </StatGrid>
  );
}

async function AtRiskTable() {
  // Fetch los 3 segmentos accionables ordenados por contact_priority_score
  const [atRisk, needAtt, hibernating] = await Promise.all([
    getRfmSegments("AT_RISK", 100),
    getRfmSegments("NEED_ATTENTION", 100),
    getRfmSegments("HIBERNATING", 100),
  ]);
  const all = [...atRisk, ...needAtt, ...hibernating]
    .filter((r) => r.monetary_12m > 0)
    .sort((a, b) => b.contact_priority_score - a.contact_priority_score);

  if (all.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin clientes en riesgo"
        description="Todos los clientes están activos."
      />
    );
  }

  return (
    <DataTable
      data={all}
      columns={columns}
      rowKey={(r) => String(r.company_id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              truncate
            />
          }
          subtitle={
            <Badge
              variant={segmentColor[r.segment] ?? "secondary"}
              className="text-[10px] uppercase"
            >
              {r.segment.replace("_", " ")}
            </Badge>
          }
          badge={priorityBadge(r.contact_priority_score)}
          fields={[
            { label: "Días sin comprar", value: `${r.recency_days}d` },
            {
              label: "Revenue 12m",
              value: <Currency amount={r.monetary_12m} compact />,
            },
            { label: "Compras 2y", value: r.frequency },
            {
              label: "Última",
              value: <DateDisplay date={r.last_purchase} relative />,
            },
          ]}
        />
      )}
    />
  );
}
