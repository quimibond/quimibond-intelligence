"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Database,
  Mail,
  Package,
  ShoppingCart,
  Server,
  Truck,
  TrendingUp,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import type { PipelineRun, SyncCommand, SystemStats } from "@/lib/types";
import { DataFreshness } from "@/components/shared/data-freshness";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PipelineTrigger } from "./components/pipeline-trigger";
import { OdooSyncTrigger } from "./components/odoo-sync-trigger";
import { MaintenancePanel } from "./components/maintenance-panel";
import { TokenUsageCard } from "./components/token-usage-card";
import { AutoFixLogsCard } from "./components/auto-fix-logs";

// ── Status config (shared for pipeline runs + sync commands tables) ──

const statusConfig: Record<string, { variant: "success" | "warning" | "critical" | "info" | "secondary"; icon: typeof CheckCircle2 }> = {
  completed: { variant: "success", icon: CheckCircle2 },
  running: { variant: "info", icon: Activity },
  failed: { variant: "critical", icon: XCircle },
  partial: { variant: "warning", icon: AlertTriangle },
  pending: { variant: "warning", icon: Clock },
  error: { variant: "critical", icon: XCircle },
};

// ── Main Page ──

export default function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [syncCommands, setSyncCommands] = useState<SyncCommand[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [runLogs, setRunLogs] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const refreshData = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    async function fetchData() {
      async function safeCount(table: string, filter?: { col: string; val: string }) {
        try {
          let query = supabase.from(table).select("id", { count: "exact", head: true });
          if (filter) query = query.eq(filter.col, filter.val);
          const { count } = await query;
          return count ?? 0;
        } catch {
          return 0;
        }
      }

      try {
      const [
        totalCompanies, totalContacts, totalEmails, totalThreads,
        totalEntities, totalFacts, totalRelationships,
        activeAlerts, pendingActions, totalBriefings, totalHealthScores,
        totalOdooInvoices, totalOdooDeliveries, totalOdooPayments,
        totalOdooProducts, totalOdooOrderLines, totalOdooCrmLeads,
        totalOdooActivities, totalOdooUsers,
        pipelineRes, cmdRes,
      ] = await Promise.all([
        safeCount("companies"), safeCount("contacts"),
        safeCount("emails"), safeCount("threads"),
        safeCount("entities"), safeCount("facts"), safeCount("entity_relationships"),
        safeCount("alerts", { col: "state", val: "new" }),
        safeCount("action_items", { col: "state", val: "pending" }),
        safeCount("briefings"), safeCount("health_scores"),
        safeCount("odoo_invoices"), safeCount("odoo_deliveries"),
        safeCount("odoo_payments"), safeCount("odoo_products"),
        safeCount("odoo_order_lines"), safeCount("odoo_crm_leads"),
        safeCount("odoo_activities"), safeCount("odoo_users"),
        supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(10),
        supabase.from("sync_commands").select("*").order("created_at", { ascending: false }).limit(10),
      ]);

      setStats({
        totalCompanies, totalContacts, totalEmails, totalThreads,
        totalEntities, totalFacts, totalRelationships,
        activeAlerts, pendingActions, totalBriefings, totalHealthScores,
        totalOdooInvoices, totalOdooDeliveries, totalOdooPayments,
        totalOdooProducts, totalOdooOrderLines, totalOdooCrmLeads,
        totalOdooActivities, totalOdooUsers,
      });
      setPipelineRuns((pipelineRes.data ?? []) as PipelineRun[]);
      setSyncCommands((cmdRes.data ?? []) as SyncCommand[]);
      } catch (err) {
        console.error("[system] Failed to load:", err);
      }
      setLoading(false);
    }
    fetchData();
  }, [fetchKey]);

  const toggleRunLogs = useCallback(async (runId: string) => {
    if (expandedRunId === runId) { setExpandedRunId(null); return; }
    setExpandedRunId(runId);
    if (!runLogs[runId]) {
      const { data } = await supabase.from("pipeline_logs").select("*").eq("run_id", runId).order("created_at", { ascending: true });
      setRunLogs((prev) => ({ ...prev, [runId]: data ?? [] }));
    }
  }, [expandedRunId, runLogs]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sistema" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)}
        </div>
        <Skeleton className="h-[200px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="Sistema" description="Estado del sistema, pipelines y sincronizacion" />
        <DataFreshness />
      </div>

      {/* Data Stats */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Datos del Sistema</h3>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <StatCard title="Empresas" value={stats?.totalCompanies.toLocaleString() ?? "0"} icon={Database} />
          <StatCard title="Contactos" value={stats?.totalContacts.toLocaleString() ?? "0"} icon={Users} />
          <StatCard title="Emails" value={stats?.totalEmails.toLocaleString() ?? "0"} icon={Mail} />
          <StatCard title="Alertas activas" value={stats?.activeAlerts.toLocaleString() ?? "0"} icon={Bell} />
          <StatCard title="Acciones pend." value={stats?.pendingActions.toLocaleString() ?? "0"} icon={Clock} />
        </div>
      </div>

      {/* Odoo Data */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Datos de Odoo</h3>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <StatCard title="Productos" value={stats?.totalOdooProducts.toLocaleString() ?? "0"} icon={Package} />
          <StatCard title="Lineas de Orden" value={stats?.totalOdooOrderLines.toLocaleString() ?? "0"} icon={ShoppingCart} />
          <StatCard title="Facturas" value={stats?.totalOdooInvoices.toLocaleString() ?? "0"} icon={CreditCard} />
          <StatCard title="Entregas" value={stats?.totalOdooDeliveries.toLocaleString() ?? "0"} icon={Truck} />
          <StatCard title="Pagos" value={stats?.totalOdooPayments.toLocaleString() ?? "0"} icon={TrendingUp} />
          <StatCard title="CRM Leads" value={stats?.totalOdooCrmLeads.toLocaleString() ?? "0"} icon={TrendingUp} />
          <StatCard title="Actividades" value={stats?.totalOdooActivities.toLocaleString() ?? "0"} icon={CheckCircle2} />
          <StatCard title="Usuarios" value={stats?.totalOdooUsers.toLocaleString() ?? "0"} icon={UserCog} />
        </div>
      </div>

      {/* Pipeline Trigger */}
      <PipelineTrigger onComplete={refreshData} />

      {/* Odoo Sync */}
      <OdooSyncTrigger onComplete={refreshData} />

      {/* Maintenance */}
      <MaintenancePanel onComplete={refreshData} />

      {/* Pipeline Runs */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Pipeline Runs (Vercel)</CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin ejecuciones registradas.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Duracion</TableHead>
                    <TableHead className="text-right">Emails</TableHead>
                    <TableHead className="text-right">Alertas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipelineRuns.map((run) => {
                    const cfg = statusConfig[run.status] ?? statusConfig.partial;
                    const StatusIcon = cfg.icon;
                    const isExpanded = expandedRunId === run.id;
                    const logs = runLogs[run.id] ?? [];
                    return (
                      <Fragment key={run.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleRunLogs(run.id)}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1">
                              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                              {run.run_type}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={cfg.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">{timeAgo(run.started_at)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {run.duration_seconds != null ? `${Math.round(run.duration_seconds)}s` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{run.emails_processed ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{run.alerts_generated ?? "—"}</TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <div className="rounded-lg bg-muted/50 p-3 space-y-1 max-h-48 overflow-y-auto">
                                {logs.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">Sin logs.</p>
                                ) : (
                                  logs.map((log) => (
                                    <div key={log.id} className="flex items-start gap-2 text-xs">
                                      <Badge variant={log.level === "error" ? "critical" : log.level === "warning" ? "warning" : "secondary"} className="text-[10px] shrink-0">{log.level}</Badge>
                                      {log.phase && <span className="font-medium text-muted-foreground shrink-0">[{log.phase}]</span>}
                                      <span>{log.message}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Commands */}
      {syncCommands.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Server className="h-5 w-5 text-warning" />
            <CardTitle className="text-base">Comandos Odoo Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comando</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Enviado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncCommands.map((cmd) => {
                    const cfg = statusConfig[cmd.status] ?? statusConfig.pending;
                    const StatusIcon = cfg.icon;
                    return (
                      <TableRow key={cmd.id}>
                        <TableCell className="font-mono text-sm">{cmd.command}</TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {cmd.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {cmd.result == null ? "—" : typeof cmd.result === "object" ? JSON.stringify(cmd.result) : String(cmd.result)}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">{timeAgo(cmd.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Token Usage */}
      <TokenUsageCard />

      {/* Auto-fix / Validate Logs */}
      <AutoFixLogsCard />
    </div>
  );
}
