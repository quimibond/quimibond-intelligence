import { Suspense } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Inbox,
  Target,
  TrendingUp,
} from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  EmptyState,
  Currency,
  DateDisplay,
} from "@/components/shared/v2";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import {
  getAgentEffectiveness,
  type AgentEffectivenessRow,
} from "@/lib/queries/system";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Directores" };

export default function AgentsPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Directores IA"
        subtitle="¿Qué agentes están trabajando y qué tan efectivos son?"
      />

      <Suspense fallback={<KpisSkeleton />}>
        <AgentsKpisSection />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-xl" />
            ))}
          </div>
        }
      >
        <AgentsList />
      </Suspense>
    </div>
  );
}

function KpisSkeleton() {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[96px] rounded-xl" />
      ))}
    </StatGrid>
  );
}

async function AgentsKpisSection() {
  const agents = await getAgentEffectiveness();
  const totalInsights = agents.reduce((a, r) => a + r.total_insights, 0);
  const insights24h = agents.reduce((a, r) => a + r.insights_24h, 0);
  const totalImpact = agents.reduce(
    (a, r) => a + (r.impact_delivered_mxn ?? 0),
    0
  );
  const avgActed =
    agents.filter((a) => a.acted_rate_pct != null).length > 0
      ? agents.reduce((a, r) => a + (r.acted_rate_pct ?? 0), 0) /
        agents.filter((a) => a.acted_rate_pct != null).length
      : 0;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Directores activos"
        value={agents.length}
        format="number"
        icon={Bot}
      />
      <KpiCard
        title="Insights generados"
        value={totalInsights}
        format="number"
        icon={Inbox}
        subtitle={`${insights24h} en 24h`}
      />
      <KpiCard
        title="Acted rate promedio"
        value={avgActed}
        format="percent"
        icon={Target}
        tone={
          avgActed >= 30 ? "success" : avgActed >= 15 ? "warning" : "danger"
        }
      />
      <KpiCard
        title="Impacto entregado"
        value={totalImpact}
        format="currency"
        compact
        icon={TrendingUp}
        subtitle="acciones del CEO"
        tone="success"
      />
    </StatGrid>
  );
}

async function AgentsList() {
  const agents = await getAgentEffectiveness();
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="Sin directores activos"
        description="No hay agentes activos en agent_effectiveness."
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => (
        <AgentCard key={a.agent_id} agent={a} />
      ))}
    </div>
  );
}

function AgentCard({ agent: a }: { agent: AgentEffectivenessRow }) {
  const actedTone =
    a.acted_rate_pct == null
      ? "secondary"
      : a.acted_rate_pct >= 30
        ? "success"
        : a.acted_rate_pct >= 15
          ? "warning"
          : "critical";

  return (
    <Link href={`/agents/${a.slug}`} className="block">
      <Card className="gap-2 py-4 transition-colors active:bg-accent/50">
        <div className="flex items-start justify-between gap-2 px-4">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{a.name}</div>
              {a.domain && (
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {a.domain}
                </div>
              )}
            </div>
          </div>
          <ChevronRight
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 pt-1 text-center">
          <div>
            <div className="text-lg font-bold tabular-nums">
              {a.total_insights}
            </div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Insights
            </div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums">
              {a.state_acted}
            </div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Acted
            </div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums">{a.runs_24h}</div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Runs 24h
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 pt-1">
          <Badge variant={actedTone}>
            {a.acted_rate_pct != null
              ? `${a.acted_rate_pct.toFixed(0)}% acted`
              : "Sin datos"}
          </Badge>
          {a.impact_delivered_mxn != null && a.impact_delivered_mxn > 0 && (
            <span className="text-xs font-semibold text-success">
              <Currency amount={a.impact_delivered_mxn} compact /> impacto
            </span>
          )}
        </div>

        {a.last_run_at && (
          <div className="flex items-center gap-1 px-4 pt-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            Última corrida <DateDisplay date={a.last_run_at} relative />
            {a.avg_duration_s != null && (
              <span> · {a.avg_duration_s.toFixed(1)}s prom.</span>
            )}
          </div>
        )}

        {a.insights_24h > 0 && (
          <div className="flex items-center gap-1 px-4 text-[11px] text-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {a.insights_24h} insights en últimas 24h
          </div>
        )}
      </Card>
    </Link>
  );
}
