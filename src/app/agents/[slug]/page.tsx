import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Clock,
  Inbox,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import {
  PageHeader,
  StatGrid,
  KpiCard,
  DataTable,
  MobileCard,
  DateDisplay,
  EmptyState,
  MetricRow,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  getAgentBySlug,
  getAgentRuns,
  getAgentMemory,
  type AgentRunRow,
  type AgentMemoryRow,
} from "@/lib/queries/system";
import { getInsights, type InsightRow } from "@/lib/queries/insights";
import { formatNumber } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  return { title: agent?.name ?? "Director" };
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) notFound();

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Todos los directores
      </Link>

      <PageHeader
        title={agent.name}
        subtitle={agent.description ?? agent.domain ?? undefined}
        actions={
          <div className="flex gap-2">
            {agent.is_active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="secondary">Pausado</Badge>
            )}
            {agent.analysis_schedule && (
              <Badge variant="outline" className="text-[10px]">
                {agent.analysis_schedule}
              </Badge>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Insights totales"
          value={agent.total_insights}
          format="number"
          icon={Inbox}
          subtitle={`${agent.insights_24h} en 24h`}
        />
        <KpiCard
          title="Acted rate"
          value={agent.acted_rate_pct}
          format="percent"
          icon={Target}
          tone={
            agent.acted_rate_pct == null
              ? "default"
              : agent.acted_rate_pct >= 30
                ? "success"
                : agent.acted_rate_pct >= 15
                  ? "warning"
                  : "danger"
          }
        />
        <KpiCard
          title="Impacto entregado"
          value={agent.impact_delivered_mxn}
          format="currency"
          compact
          icon={TrendingUp}
          tone="success"
        />
        <KpiCard
          title="Runs 24h"
          value={agent.runs_24h}
          format="number"
          icon={Zap}
          subtitle={
            agent.avg_duration_s != null
              ? `${agent.avg_duration_s.toFixed(1)}s prom.`
              : undefined
          }
        />
      </StatGrid>

      <Tabs defaultValue="performance" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="runs">Corridas</TabsTrigger>
          <TabsTrigger value="memory">Memorias</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-4">
          <PerformanceCard
            stateNew={agent.state_new}
            stateActed={agent.state_acted}
            stateDismissed={agent.state_dismissed}
            actedRate={agent.acted_rate_pct}
            dismissRate={agent.dismiss_rate_pct}
            avgConfidence={agent.avg_confidence}
            avgImpact={agent.avg_impact_mxn}
            lastRunAt={agent.last_run_at}
            avgDuration={agent.avg_duration_s}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Insights generados</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <AgentInsightsList agentId={agent.agent_id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Corridas recientes</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <AgentRunsTable agentId={agent.agent_id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Memorias persistentes
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <AgentMemoryList agentId={agent.agent_id} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PerformanceCard({
  stateNew,
  stateActed,
  stateDismissed,
  actedRate,
  dismissRate,
  avgConfidence,
  avgImpact,
  lastRunAt,
  avgDuration,
}: {
  stateNew: number;
  stateActed: number;
  stateDismissed: number;
  actedRate: number | null;
  dismissRate: number | null;
  avgConfidence: number | null;
  avgImpact: number | null;
  lastRunAt: string | null;
  avgDuration: number | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado de los insights</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <MetricRow label="Nuevos" value={stateNew} format="number" />
          <MetricRow label="Accionados" value={stateActed} format="number" />
          <MetricRow
            label="Descartados"
            value={stateDismissed}
            format="number"
          />
          <MetricRow
            label="Acted rate"
            value={actedRate}
            format="percent"
            alert={(actedRate ?? 0) < 15}
          />
          <MetricRow
            label="Dismiss rate"
            value={dismissRate}
            format="percent"
            alert={(dismissRate ?? 0) > 50}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calidad y ejecución</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <MetricRow
            label="Confianza promedio"
            value={
              avgConfidence != null ? Math.round(avgConfidence * 100) : null
            }
            format="number"
            hint="0-100"
          />
          <MetricRow
            label="Impacto promedio"
            value={avgImpact}
            format="currency"
            compact
          />
          <MetricRow
            label="Duración promedio"
            value={avgDuration != null ? `${avgDuration.toFixed(1)}s` : "—"}
          />
          <MetricRow
            label="Última corrida"
            value={
              lastRunAt
                ? new Date(lastRunAt).toLocaleString("es-MX", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Insights generated by this agent
// ──────────────────────────────────────────────────────────────────────────
async function AgentInsightsList({ agentId }: { agentId: number }) {
  const insights = (await getInsights({
    state: ["new", "seen", "acted_on", "dismissed"],
    limit: 30,
  })) as InsightRow[];
  const filtered = insights.filter((i) => i.agent_id === agentId);

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Sin insights recientes"
        description="Este director aún no ha generado insights."
        compact
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.slice(0, 20).map((i) => (
        <Link
          key={i.id}
          href={`/inbox/insight/${i.id}`}
          className="block"
        >
          <Card className="gap-1 py-3 transition-colors active:bg-accent/50">
            <div className="px-4">
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant={
                    i.severity === "critical"
                      ? "critical"
                      : i.severity === "high"
                        ? "warning"
                        : "info"
                  }
                  className="text-[10px] uppercase"
                >
                  {i.severity ?? "—"}
                </Badge>
                {i.state && (
                  <Badge variant="outline" className="text-[10px]">
                    {i.state}
                  </Badge>
                )}
              </div>
              <div className="text-sm font-semibold truncate">
                {i.title ?? "—"}
              </div>
              {i.company_name && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {i.company_name}
                </div>
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Recent runs
// ──────────────────────────────────────────────────────────────────────────
const runStatusVariant: Record<
  string,
  "success" | "warning" | "critical" | "info" | "secondary"
> = {
  completed: "success",
  success: "success",
  running: "info",
  error: "critical",
  failed: "critical",
  cancelled: "secondary",
};

const runColumns: DataTableColumn<AgentRunRow>[] = [
  {
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={runStatusVariant[r.status ?? ""] ?? "secondary"}>
        {r.status ?? "—"}
      </Badge>
    ),
  },
  {
    key: "started",
    header: "Iniciada",
    cell: (r) => <DateDisplay date={r.started_at} relative />,
  },
  {
    key: "duration",
    header: "Duración",
    cell: (r) =>
      r.duration_seconds != null
        ? `${r.duration_seconds.toFixed(1)}s`
        : "—",
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "insights",
    header: "Insights",
    cell: (r) => (
      <span className="tabular-nums">{r.insights_generated ?? 0}</span>
    ),
    align: "right",
  },
  {
    key: "tokens",
    header: "Tokens",
    cell: (r) => (
      <span className="tabular-nums">
        {formatNumber(
          (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
          { compact: true }
        )}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
];

async function AgentRunsTable({ agentId }: { agentId: number }) {
  const rows = await getAgentRuns(agentId, 20);
  return (
    <DataTable
      data={rows}
      columns={runColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            <div className="flex items-center gap-2">
              <Badge variant={runStatusVariant[r.status ?? ""] ?? "secondary"}>
                {r.status ?? "—"}
              </Badge>
              <DateDisplay date={r.started_at} relative />
            </div>
          }
          subtitle={r.error_message ?? undefined}
          fields={[
            { label: "Insights", value: r.insights_generated ?? 0 },
            {
              label: "Duración",
              value:
                r.duration_seconds != null
                  ? `${r.duration_seconds.toFixed(1)}s`
                  : "—",
            },
            {
              label: "Tokens",
              value: formatNumber(
                (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
                { compact: true }
              ),
            },
          ]}
        />
      )}
      emptyState={{
        icon: Clock,
        title: "Sin corridas",
        description: "Este director no se ha ejecutado todavía.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Memory
// ──────────────────────────────────────────────────────────────────────────
async function AgentMemoryList({ agentId }: { agentId: number }) {
  const rows = await getAgentMemory(agentId, 30);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="Sin memorias"
        description="Este director no ha aprendido nada todavía."
        compact
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((m) => (
        <MemoryCard key={m.id} memory={m} />
      ))}
    </div>
  );
}

function MemoryCard({ memory: m }: { memory: AgentMemoryRow }) {
  return (
    <Card className="gap-1 py-3">
      <div className="px-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          {m.memory_type && (
            <Badge variant="secondary" className="text-[10px] uppercase">
              {m.memory_type}
            </Badge>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {m.importance != null && (
              <span>imp {m.importance.toFixed(2)}</span>
            )}
            {m.times_used != null && m.times_used > 0 && (
              <span>· usada {m.times_used}×</span>
            )}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-xs text-foreground">
          {m.content ?? "—"}
        </p>
        {m.last_used_at && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Última vez <DateDisplay date={m.last_used_at} relative />
          </div>
        )}
      </div>
    </Card>
  );
}
