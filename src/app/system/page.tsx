import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Database,
  DollarSign,
  ShieldCheck,
  Zap,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  TableExportButton,
  MobileCard,
  DateDisplay,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";

import { SyntageHealthPanel } from "@/components/system/SyntageHealthPanel";
import { SyntageReconciliationPanel } from "@/components/system/SyntageReconciliationPanel";
import { FiscalHistoricoPanel } from "@/components/fiscal/FiscalHistoricoPanel";
import {
  getSystemKpis,
  getSyncFreshness,
  getCostBreakdown,
  getAgentEffectiveness,
  getDataQuality,
  getDqInvariants,
  getNotifications,
  getPipelineLogsPage,
  getPipelineLogPhaseOptions,
  type SyncFreshnessRow,
  type CostRow,
  type AgentEffectivenessRow,
  type DataQualityRow,
  type DqInvariant,
  type NotificationRow,
  type PipelineLogRow,
} from "@/lib/queries/system";
import { parseTableParams } from "@/lib/queries/table-params";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Sistema" };

type SearchParams = Record<string, string | string[] | undefined>;

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

export default async function SystemPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // Support ?tab=historico-fiscal to deep-link into syntage sub-tab
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const outerTab =
    tabParam === "historico-fiscal" ? "syntage" : (tabParam ?? "sync");
  const innerSyntageTab =
    tabParam === "historico-fiscal" ? "historico-fiscal" : "health";

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Sistema"
        subtitle="Sync, costos de Claude API, agentes y calidad de datos"
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
        <SystemKpisSection />
      </Suspense>

      <Tabs defaultValue={outerTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="costs">Costos</TabsTrigger>
          <TabsTrigger value="agents">Agentes</TabsTrigger>
          <TabsTrigger value="quality">Calidad</TabsTrigger>
          <TabsTrigger value="syntage">Syntage</TabsTrigger>
          <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="mt-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">
                Frescura del sync Odoo → Supabase
              </CardTitle>
              <TableExportButton filename="sync-freshness" />
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <SyncTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">
                Costos de Claude API por endpoint
              </CardTitle>
              <TableExportButton filename="api-costs" />
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <CostsTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">
                Efectividad de los agentes
              </CardTitle>
              <TableExportButton filename="agent-effectiveness" />
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <AgentsTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Integridad del sistema
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                14 invariantes monitoreados (dq_invariants RPC). Previene regresiones silenciosas como la del audit 2026-04-16.
              </p>
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[200px]" />}>
                <DqInvariantsPanel />
              </Suspense>
            </CardContent>
          </Card>

          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">
                Scorecard de calidad de datos
              </CardTitle>
              <TableExportButton filename="data-quality" />
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <QualityTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="syntage" className="mt-4 space-y-4">
          <Tabs defaultValue={innerSyntageTab} className="w-full">
            <TabsList>
              <TabsTrigger value="health">Health &amp; backfill</TabsTrigger>
              <TabsTrigger value="reconciliation">Reconciliación</TabsTrigger>
              <TabsTrigger value="historico-fiscal">Histórico Fiscal</TabsTrigger>
            </TabsList>

            <TabsContent value="health" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sincronización Syntage (SAT)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Estado del backfill fiscal: extractions, cross-check con Odoo, error rate, distribución por año.
                  </p>
                </CardHeader>
                <CardContent className="pb-4">
                  <Suspense fallback={<Skeleton className="h-[600px]" />}>
                    <SyntageHealthPanel />
                  </Suspense>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reconciliation" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Layer 3 · Reconciliación Syntage vs Odoo</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    invoices_unified + reconciliation_issues. Refresh automático cada 15min via pg_cron. Spec: Fase 3.
                  </p>
                </CardHeader>
                <CardContent className="pb-4">
                  <Suspense fallback={<Skeleton className="h-[600px]" />}>
                    <SyntageReconciliationPanel />
                  </Suspense>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historico-fiscal" className="mt-4">
              <Suspense fallback={<Skeleton className="h-[800px]" />}>
                <FiscalHistoricoPanel />
              </Suspense>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-base">
                Cola de notificaciones
              </CardTitle>
              <TableExportButton filename="notifications" />
            </CardHeader>
            <CardContent className="pb-4">
              <Suspense fallback={<Skeleton className="h-[300px]" />}>
                <NotificationsTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card data-table-export-root>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Pipeline logs</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Busca en el mensaje, filtra por nivel, fase o rango de
                  fecha.
                </p>
              </div>
              <TableExportButton filename="pipeline-logs" />
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <Suspense fallback={null}>
                <LogsToolbar />
              </Suspense>
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <LogsTable searchParams={sp} />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs
// ──────────────────────────────────────────────────────────────────────────
async function SystemKpisSection() {
  const k = await getSystemKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Sync stale"
        value={`${k.syncStaleCount}/${k.syncTablesTotal}`}
        icon={Database}
        subtitle="tablas atrasadas"
        tone={
          k.syncStaleCount === 0
            ? "success"
            : k.syncStaleCount > 3
              ? "danger"
              : "warning"
        }
      />
      <KpiCard
        title="Costo 24h"
        value={formatUsd(k.cost24hUsd)}
        icon={DollarSign}
        subtitle={`${formatNumber(k.callsTotal)} llamadas total`}
      />
      <KpiCard
        title="Calidad de datos"
        value={k.qualityIssuesCritical + k.qualityIssuesWarning}
        format="number"
        icon={ShieldCheck}
        subtitle={`${k.qualityIssuesCritical} críticos`}
        tone={
          k.qualityIssuesCritical > 0
            ? "danger"
            : k.qualityIssuesWarning > 0
              ? "warning"
              : "success"
        }
      />
      <KpiCard
        title="Notificaciones"
        value={k.pendingNotifications}
        format="number"
        icon={Bell}
        subtitle={
          k.failedNotifications > 0
            ? `${k.failedNotifications} fallidas`
            : "pendientes"
        }
        tone={k.failedNotifications > 0 ? "warning" : "default"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sync tab
// ──────────────────────────────────────────────────────────────────────────
const syncStatusVariant: Record<
  string,
  "success" | "warning" | "critical" | "secondary"
> = {
  fresh: "success",
  warning: "warning",
  stale: "critical",
  unknown: "secondary",
};
const syncStatusLabel: Record<string, string> = {
  fresh: "Fresca",
  warning: "Atrasada",
  stale: "Stale",
  unknown: "Sin sync",
};

const syncColumns: DataTableColumn<SyncFreshnessRow>[] = [
  {
    key: "table",
    header: "Tabla",
    cell: (r) => <span className="font-mono text-xs">{r.table_name}</span>,
  },
  {
    key: "rows",
    header: "Rows",
    cell: (r) => (
      <span className="tabular-nums">{formatNumber(r.row_count)}</span>
    ),
    align: "right",
  },
  {
    key: "ago",
    header: "Hace",
    cell: (r) =>
      r.hours_ago != null ? `${r.hours_ago.toFixed(1)}h` : "—",
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "last",
    header: "Último sync",
    cell: (r) => <DateDisplay date={r.last_sync} relative />,
    hideOnMobile: true,
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={syncStatusVariant[r.status] ?? "secondary"}>
        {syncStatusLabel[r.status] ?? r.status}
      </Badge>
    ),
  },
];

async function SyncTable() {
  const rows = await getSyncFreshness();
  return (
    <DataTable
      data={rows}
      columns={syncColumns}
      rowKey={(r) => r.table_name}
      mobileCard={(r) => (
        <MobileCard
          title={r.table_name}
          subtitle={`${formatNumber(r.row_count)} rows`}
          badge={
            <Badge variant={syncStatusVariant[r.status] ?? "secondary"}>
              {syncStatusLabel[r.status] ?? r.status}
            </Badge>
          }
          fields={[
            {
              label: "Hace",
              value:
                r.hours_ago != null ? `${r.hours_ago.toFixed(1)}h` : "—",
            },
            {
              label: "Último",
              value: <DateDisplay date={r.last_sync} relative />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Database,
        title: "Sin tablas",
        description: "No hay datos de odoo_sync_freshness.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Costs tab
// ──────────────────────────────────────────────────────────────────────────
const costColumns: DataTableColumn<CostRow>[] = [
  {
    key: "endpoint",
    header: "Endpoint",
    cell: (r) => <span className="font-mono text-xs">{r.endpoint}</span>,
  },
  {
    key: "model",
    header: "Modelo",
    cell: (r) => <span className="text-xs">{r.model}</span>,
    hideOnMobile: true,
  },
  {
    key: "calls",
    header: "Llamadas",
    cell: (r) => formatNumber(r.calls),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "tokens",
    header: "Tokens",
    cell: (r) => (
      <span className="tabular-nums">
        {formatNumber(r.totalInputTokens + r.totalOutputTokens, {
          compact: true,
        })}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "cost_24h",
    header: "24h",
    cell: (r) => formatUsd(r.cost24hUsd),
    align: "right",
  },
  {
    key: "cost_total",
    header: "Total",
    cell: (r) => (
      <span className="font-semibold">{formatUsd(r.totalCostUsd)}</span>
    ),
    align: "right",
  },
];

async function CostsTable() {
  const rows = await getCostBreakdown();
  return (
    <DataTable
      data={rows}
      columns={costColumns}
      rowKey={(r, i) => `${r.endpoint}-${r.model}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.endpoint}
          subtitle={r.model}
          badge={
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">
              {formatUsd(r.totalCostUsd)}
            </span>
          }
          fields={[
            { label: "24h", value: formatUsd(r.cost24hUsd) },
            { label: "7d", value: formatUsd(r.cost7dUsd) },
            { label: "Llamadas", value: formatNumber(r.calls) },
            {
              label: "Tokens",
              value: formatNumber(r.totalInputTokens + r.totalOutputTokens, {
                compact: true,
              }),
            },
          ]}
        />
      )}
      emptyState={{
        icon: DollarSign,
        title: "Sin costos",
        description: "No hay registros en token_usage.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Agents tab
// ──────────────────────────────────────────────────────────────────────────
const agentColumns: DataTableColumn<AgentEffectivenessRow>[] = [
  {
    key: "name",
    header: "Agente",
    cell: (r) => (
      <div className="flex flex-col">
        <span className="font-semibold">{r.name}</span>
        <span className="text-[10px] uppercase text-muted-foreground">
          {r.domain ?? "—"}
        </span>
      </div>
    ),
  },
  {
    key: "insights",
    header: "Insights",
    cell: (r) => (
      <div className="text-right">
        <div className="font-semibold tabular-nums">{r.total_insights}</div>
        <div className="text-[10px] text-muted-foreground">
          {r.insights_24h} 24h
        </div>
      </div>
    ),
    align: "right",
  },
  {
    key: "acted",
    header: "Acted",
    cell: (r) =>
      r.acted_rate_pct != null ? (
        <span
          className={
            r.acted_rate_pct >= 50
              ? "text-success"
              : r.acted_rate_pct >= 25
                ? "text-warning"
                : "text-danger"
          }
        >
          {r.acted_rate_pct.toFixed(0)}%
        </span>
      ) : (
        "—"
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "impact",
    header: "Impacto entregado",
    cell: (r) =>
      r.impact_delivered_mxn != null
        ? formatCurrencyMXN(r.impact_delivered_mxn, { compact: true })
        : "—",
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "last_run",
    header: "Última corrida",
    cell: (r) => <DateDisplay date={r.last_run_at} relative />,
  },
];

async function AgentsTable() {
  const rows = await getAgentEffectiveness();
  return (
    <DataTable
      data={rows}
      columns={agentColumns}
      rowKey={(r) => String(r.agent_id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name}
          subtitle={r.domain ?? undefined}
          badge={
            r.acted_rate_pct != null ? (
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                  r.acted_rate_pct >= 50
                    ? "bg-success/15 text-success-foreground"
                    : r.acted_rate_pct >= 25
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-danger/15 text-danger-foreground"
                }`}
              >
                {r.acted_rate_pct.toFixed(0)}% acted
              </span>
            ) : undefined
          }
          fields={[
            { label: "Total", value: r.total_insights },
            { label: "24h", value: r.insights_24h },
            {
              label: "Impacto",
              value:
                r.impact_delivered_mxn != null
                  ? formatCurrencyMXN(r.impact_delivered_mxn, {
                      compact: true,
                    })
                  : "—",
            },
            {
              label: "Última",
              value: <DateDisplay date={r.last_run_at} relative />,
            },
          ]}
        />
      )}
      emptyState={{
        icon: Bot,
        title: "Sin agentes activos",
        description: "No hay agentes en agent_effectiveness.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Quality tab
// ──────────────────────────────────────────────────────────────────────────
const severityVariant: Record<
  string,
  "success" | "warning" | "critical" | "secondary"
> = {
  ok: "success",
  info: "secondary",
  warning: "warning",
  critical: "critical",
};

async function QualityTable() {
  const rows = await getDataQuality();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Sin métricas de calidad"
        description="data_quality_scorecard está vacío."
        compact
      />
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <QualityCard key={`${r.category}-${r.metric}-${i}`} row={r} />
      ))}
    </div>
  );
}

function QualityCard({ row }: { row: DataQualityRow }) {
  const isOk = row.severity === "ok" || row.value <= row.threshold;
  return (
    <Card className="gap-1 py-3">
      <div className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge
              variant={severityVariant[row.severity] ?? "secondary"}
              className="text-[10px] uppercase"
            >
              {row.severity}
            </Badge>
            <span className="text-[10px] uppercase text-muted-foreground">
              {row.category}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-semibold">{row.metric}</div>
          {row.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.description}
            </p>
          )}
        </div>
        <div className="text-right">
          <div
            className={`text-xl font-bold tabular-nums ${
              isOk ? "text-success" : "text-danger"
            }`}
          >
            {formatNumber(row.value)}
          </div>
          {row.threshold > 0 && (
            <div className="text-[10px] text-muted-foreground">
              ≤ {formatNumber(row.threshold)}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Data Quality invariants panel
// ──────────────────────────────────────────────────────────────────────────
const invariantSeverityVariant: Record<
  DqInvariant["severity"],
  "success" | "warning" | "critical" | "info" | "secondary"
> = {
  CRITICAL: "critical",
  HIGH: "warning",
  WARNING: "info",
  INFO: "secondary",
};

async function DqInvariantsPanel() {
  const rows = await getDqInvariants();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Sin invariantes"
        description="RPC dq_invariants() no devolvió filas."
        compact
      />
    );
  }
  const ok = rows.filter((r) => r.ok).length;
  const issues = rows.filter((r) => !r.ok);
  const criticalIssues = issues.filter((r) => r.severity === "CRITICAL").length;
  const highIssues = issues.filter((r) => r.severity === "HIGH").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={criticalIssues === 0 ? "success" : "critical"}>
          {ok}/{rows.length} OK
        </Badge>
        {criticalIssues > 0 && (
          <Badge variant="critical">{criticalIssues} CRITICAL</Badge>
        )}
        {highIssues > 0 && (
          <Badge variant="warning">{highIssues} HIGH</Badge>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.check_name}
            className={`flex items-start gap-3 rounded-md border p-2.5 ${
              r.ok ? "border-border/50 bg-muted/20" : "border-warning/40 bg-warning/5"
            }`}
          >
            <Badge
              variant={r.ok ? "success" : invariantSeverityVariant[r.severity]}
              className="mt-0.5 shrink-0 text-[10px] uppercase"
            >
              {r.ok ? "OK" : r.severity}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono text-foreground">
                {r.check_name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.message}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                <span className="tabular-nums">{r.value}</span>
                <span className="mx-1">·</span>
                <span className="tabular-nums">expected {r.expected}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Notifications tab
// ──────────────────────────────────────────────────────────────────────────
const notifStatusVariant: Record<
  string,
  "success" | "warning" | "critical" | "info" | "secondary"
> = {
  sent: "success",
  pending: "info",
  failed: "critical",
  cancelled: "secondary",
};

const notifColumns: DataTableColumn<NotificationRow>[] = [
  {
    key: "channel",
    header: "Canal",
    cell: (r) => <span className="font-mono text-xs">{r.channel ?? "—"}</span>,
  },
  {
    key: "title",
    header: "Mensaje",
    cell: (r) => <span className="truncate text-xs">{r.title ?? "—"}</span>,
  },
  {
    key: "recipient",
    header: "Destinatario",
    cell: (r) => r.recipient_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) => (
      <Badge variant={notifStatusVariant[r.status ?? ""] ?? "secondary"}>
        {r.status ?? "—"}
      </Badge>
    ),
  },
  {
    key: "created",
    header: "Creado",
    cell: (r) => <DateDisplay date={r.created_at} relative />,
    hideOnMobile: true,
  },
];

async function NotificationsTable() {
  const rows = await getNotifications(30);
  return (
    <DataTable
      data={rows}
      columns={notifColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.title ?? "—"}
          subtitle={r.recipient_name ?? r.channel ?? undefined}
          badge={
            <Badge variant={notifStatusVariant[r.status ?? ""] ?? "secondary"}>
              {r.status ?? "—"}
            </Badge>
          }
          fields={[
            { label: "Canal", value: r.channel ?? "—" },
            { label: "Creado", value: <DateDisplay date={r.created_at} relative /> },
          ]}
        />
      )}
      emptyState={{
        icon: Bell,
        title: "Sin notificaciones",
        description: "La cola está vacía.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline logs
// ──────────────────────────────────────────────────────────────────────────
async function LogsToolbar() {
  const phases = await getPipelineLogPhaseOptions();
  return (
    <DataTableToolbar
      paramPrefix="lg_"
      searchPlaceholder="Buscar en mensaje…"
      dateRange={{ label: "Fecha" }}
      facets={[
        {
          key: "level",
          label: "Nivel",
          options: [
            { value: "error", label: "Error" },
            { value: "warning", label: "Warning" },
            { value: "info", label: "Info" },
            { value: "debug", label: "Debug" },
          ],
        },
        {
          key: "phase",
          label: "Fase",
          options: phases.map((p) => ({ value: p, label: p })),
        },
      ]}
    />
  );
}

async function LogsTable({ searchParams }: { searchParams: SearchParams }) {
  const params = parseTableParams(searchParams, {
    prefix: "lg_",
    facetKeys: ["level", "phase"],
    defaultSize: 50,
  });
  const { rows, total } = await getPipelineLogsPage({
    ...params,
    level: params.facets.level,
    phase: params.facets.phase,
  });
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Sin logs"
        description="Ajusta los filtros o el rango de fechas."
        compact
      />
    );
  }
  return (
    <div className="space-y-3">
      {/* Ocultamos el table HTML para el export pero renderizamos */}
      <div className="hidden">
        <table>
          <thead>
            <tr>
              <th>Nivel</th>
              <th>Fase</th>
              <th>Mensaje</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{l.level}</td>
                <td>{l.phase}</td>
                <td>{l.message}</td>
                <td>{l.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1.5">
        {rows.map((log) => (
          <LogLine key={log.id} log={log} />
        ))}
      </div>
      <DataTablePagination
        paramPrefix="lg_"
        total={total}
        page={params.page}
        pageSize={params.size}
        pageSizeOptions={[25, 50, 100, 200]}
        unit="logs"
      />
    </div>
  );
}

function LogLine({ log }: { log: PipelineLogRow }) {
  const levelColor: Record<string, string> = {
    error: "text-danger border-danger/30",
    warning: "text-warning border-warning/30",
    info: "text-info border-border",
    debug: "text-muted-foreground border-border",
  };
  const Icon =
    log.level === "error"
      ? AlertTriangle
      : log.level === "warning"
        ? AlertTriangle
        : log.level === "info"
          ? Zap
          : CheckCircle2;

  return (
    <div
      className={`flex items-start gap-2 rounded-md border-l-2 bg-card px-3 py-2 text-xs ${
        levelColor[log.level ?? "info"] ?? levelColor.info
      }`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {log.phase && (
            <span className="font-mono text-[10px] uppercase">
              {log.phase}
            </span>
          )}
          <DateDisplay
            date={log.created_at}
            relative
            className="text-[10px] text-muted-foreground"
          />
        </div>
        <div className="mt-0.5 break-words font-mono text-[11px] text-foreground">
          {log.message ?? "—"}
        </div>
      </div>
    </div>
  );
}
