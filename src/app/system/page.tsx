"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Bell,
  Brain,
  CheckCircle2,
  Clock,
  Mail,
  Package,
  RefreshCw,
  Server,
  ShoppingCart,
  UserCog,
  Users,
  ChevronDown,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, timeAgo } from "@/lib/utils";
import type { PipelineRun, SyncState } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { PredictionStats } from "@/components/shared/prediction-stats";
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

interface SystemStats {
  totalEmails: number;
  totalContacts: number;
  activeAlerts: number;
  totalEntities: number;
  totalFacts: number;
  totalActions: number;
  totalOdooProducts: number;
  totalOdooOrderLines: number;
  totalOdooUsers: number;
}

const statusConfig: Record<string, { variant: "success" | "warning" | "critical" | "info" | "secondary"; icon: typeof CheckCircle2 }> = {
  completed: { variant: "success", icon: CheckCircle2 },
  running: { variant: "info", icon: Activity },
  failed: { variant: "critical", icon: XCircle },
  partial: { variant: "warning", icon: AlertTriangle },
};

// ── Odoo Command Dispatcher ──
async function sendOdooCommand(command: string): Promise<string> {
  // Insert command into sync_commands table — Odoo picks it up every 5 min
  const { data, error } = await supabase
    .from("sync_commands")
    .insert({ command, status: "pending" })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42P01" || error.message?.includes("does not exist")) {
      throw new Error(
        "La tabla sync_commands no existe. Ejecuta la migracion 017_sync_commands_and_decay.sql en Supabase."
      );
    }
    throw new Error(error.message);
  }

  // Poll for completion (max 10 min)
  const cmdId = data.id;
  const maxWait = 600_000;
  const pollInterval = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const { data: cmd } = await supabase
      .from("sync_commands")
      .select("status, result")
      .eq("id", cmdId)
      .single();
    if (!cmd) break;
    if (cmd.status === "completed") {
      const elapsed = cmd.result?.elapsed_s ? ` (${cmd.result.elapsed_s}s)` : "";
      return `Completado${elapsed}`;
    }
    if (cmd.status === "failed") {
      throw new Error(cmd.result?.error ?? "Fallo en Odoo");
    }
    // still running or pending...
  }
  return "Enviado a Odoo (revisa logs para resultado)";
}

// ── Sync Control Panel ──
function SyncPanel({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  async function runAction(id: string, label: string, fn: () => Promise<string>) {
    setRunning(id);
    setResult(null);
    try {
      const msg = await fn();
      setResult({ type: "success", msg: `${label}: ${msg}` });
      toast.success(`${label}: ${msg}`);
      onComplete();
    } catch (e: unknown) {
      let errMsg = "Error desconocido";
      if (e instanceof Error) {
        errMsg = e.message;
      } else if (typeof e === "object" && e !== null && "message" in e) {
        errMsg = String((e as { message: string }).message);
      }
      // Friendlier message for missing RPC functions
      if (errMsg.includes("Could not find the function") || errMsg.includes("function") && errMsg.includes("does not exist")) {
        errMsg = "Funcion no encontrada en Supabase. Verifica que las migraciones estan aplicadas.";
      }
      setResult({ type: "error", msg: `${label}: ${errMsg}` });
      toast.error(`${label}: ${errMsg}`);
    } finally {
      setRunning(null);
    }
  }

  const actions: { id: string; label: string; desc: string; icon: typeof RefreshCw; fn: () => Promise<string> }[] = [
    {
      id: "resolve_connections",
      label: "Resolver Conexiones",
      desc: "Vincula emails→contactos, threads→empresas, entity_id",
      icon: RefreshCw,
      fn: async () => {
        const { data, error } = await supabase.rpc("resolve_all_connections");
        if (error) throw error;
        const r = data as Record<string, number>;
        const total = Object.values(r).reduce((s, v) => s + (v || 0), 0);
        return `${total} conexiones resueltas`;
      },
    },
    {
      id: "refresh_stats",
      label: "Recalcular Stats de Contactos",
      desc: "Actualiza total_sent, total_received, last_activity",
      icon: Users,
      fn: async () => {
        const { error } = await supabase.rpc("refresh_contact_360");
        if (error) throw error;
        return "Stats de contactos actualizados";
      },
    },
    {
      id: "resolve_assignees",
      label: "Resolver Asignados",
      desc: "Vincula action_items.assignee_name → email de odoo_users",
      icon: UserCog,
      fn: async () => {
        const { data, error } = await supabase.rpc("resolve_assignee_emails");
        if (error) throw error;
        return `${data ?? 0} asignados resueltos`;
      },
    },
    {
      id: "resolve_recipients",
      label: "Resolver Destinatarios",
      desc: "Vincula emails.recipient → contactos (many-to-many)",
      icon: Mail,
      fn: async () => {
        const { data, error } = await supabase.rpc("resolve_email_recipients");
        if (error) throw error;
        const r = data as { total_addresses_parsed: number; resolved_to_contacts: number };
        return `${r.resolved_to_contacts} de ${r.total_addresses_parsed} destinatarios resueltos`;
      },
    },
    {
      id: "enrich_contacts",
      label: "Enriquecer Contactos (Claude)",
      desc: "Genera perfiles con IA para contactos sin rol",
      icon: Brain,
      fn: async () => {
        const res = await fetch("/api/enrich/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "contacts", limit: 5 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        return `${data.enriched ?? 0} contactos enriquecidos`;
      },
    },
    {
      id: "enrich_companies",
      label: "Enriquecer Empresas (Claude)",
      desc: "Genera perfiles de empresa con IA",
      icon: Brain,
      fn: async () => {
        const res = await fetch("/api/enrich/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "companies", limit: 5 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        return `${data.enriched ?? 0} empresas enriquecidas`;
      },
    },
    {
      id: "decay_facts",
      label: "Decay de Hechos",
      desc: "Reduce confianza de hechos no verificados",
      icon: Clock,
      fn: async () => {
        const { data, error } = await supabase.rpc("decay_fact_confidence");
        if (error) throw error;
        return `${data ?? 0} hechos actualizados`;
      },
    },
  ];

  const odooActions: { id: string; label: string; desc: string; icon: typeof RefreshCw; command: string }[] = [
    {
      id: "odoo_sync_emails",
      label: "Sync Emails (Gmail)",
      desc: "Descarga emails nuevos de las 52 cuentas",
      icon: Mail,
      command: "run_sync_emails",
    },
    {
      id: "odoo_analyze",
      label: "Analizar Emails (Claude)",
      desc: "Genera alertas, acciones, KG, perfiles. ~3-10 min",
      icon: Brain,
      command: "run_analyze_emails",
    },
    {
      id: "odoo_enrich",
      label: "Sync Contactos (Odoo)",
      desc: "Partners + empresas con datos financieros y operacionales",
      icon: Users,
      command: "run_enrich_only",
    },
    {
      id: "odoo_tables",
      label: "Sync 8 Tablas Odoo",
      desc: "Facturas, pagos, entregas, CRM, actividades, equipo",
      icon: Server,
      command: "run_sync_odoo_tables",
    },
    {
      id: "odoo_scores",
      label: "Recalcular Scores (Odoo)",
      desc: "Health scores, risk level, sentiment",
      icon: Activity,
      command: "run_update_scores",
    },
    {
      id: "odoo_full",
      label: "Pipeline Completo (Diario)",
      desc: "Todo: sync + analisis + enrichment + scores + briefing. ~5-15 min",
      icon: RefreshCw,
      command: "run_daily_intelligence",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <RefreshCw className="h-5 w-5 text-blue-500" />
        <CardTitle>Panel de Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {result && (
          <div className={`rounded-lg p-3 text-sm ${result.type === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
            {result.msg}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;
            const isRunning = running === action.id;
            return (
              <button
                key={action.id}
                onClick={() => runAction(action.id, action.label, action.fn)}
                disabled={running !== null}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                }`}
              >
                {isRunning ? (
                  <RefreshCw className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Odoo commands section */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Ejecutar en Odoo</h3>
            <span className="text-xs text-muted-foreground">(se envia comando, Odoo lo ejecuta)</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {odooActions.map((action) => {
              const Icon = action.icon;
              const isRunning = running === action.id;
              return (
                <button
                  key={action.id}
                  onClick={() => runAction(
                    action.id,
                    action.label,
                    () => sendOdooCommand(action.command),
                  )}
                  disabled={running !== null}
                  className={`flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-left transition-colors ${
                    running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-amber-500/10 cursor-pointer"
                  }`}
                >
                  {isRunning ? (
                    <RefreshCw className="h-5 w-5 text-amber-500 animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <Icon className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{action.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Los comandos de Odoo se ejecutan en el servidor de Odoo.sh. El boton espera a que termine (~5 min max para el cron).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [runLogs, setRunLogs] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const refreshData = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    async function fetchData() {
      // Helper: safe count query that returns 0 if table doesn't exist
      async function safeCount(table: string, filter?: { col: string; val: string }) {
        let query = supabase.from(table).select("id", { count: "exact", head: true });
        if (filter) query = query.eq(filter.col, filter.val);
        const { count } = await query;
        return count ?? 0;
      }

      const [
        totalEmails, totalContacts, activeAlerts, totalEntities,
        totalFacts, totalActions, totalOdooProducts, totalOdooOrderLines,
        totalOdooUsers, syncRes, pipelineRes,
      ] = await Promise.all([
        safeCount("emails"),
        safeCount("contacts"),
        safeCount("alerts", { col: "state", val: "new" }),
        safeCount("entities"),
        safeCount("facts"),
        safeCount("action_items", { col: "state", val: "pending" }),
        safeCount("odoo_products"),
        safeCount("odoo_order_lines"),
        safeCount("odoo_users"),
        supabase.from("sync_state").select("*").order("last_sync_at", { ascending: false }),
        supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(20),
      ]);

      setStats({
        totalEmails,
        totalContacts,
        activeAlerts,
        totalEntities,
        totalFacts,
        totalActions,
        totalOdooProducts,
        totalOdooOrderLines,
        totalOdooUsers,
      });

      setSyncStates((syncRes.data ?? []) as SyncState[]);
      setPipelineRuns((pipelineRes.data ?? []) as PipelineRun[]);
      setLoading(false);
    }
    fetchData();
  }, [fetchKey]);

  const toggleRunLogs = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!runLogs[runId]) {
      const { data } = await supabase
        .from("pipeline_logs")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });
      setRunLogs((prev) => ({ ...prev, [runId]: data ?? [] }));
    }
  }, [expandedRunId, runLogs]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sistema" description="Estado del sistema, pipeline y sincronizacion" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] w-full" />
          ))}
        </div>
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sistema" description="Estado del sistema, pipeline y sincronizacion" />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Emails" value={stats?.totalEmails.toLocaleString() ?? "0"} icon={Mail} description="Sincronizados" />
        <StatCard title="Contactos" value={stats?.totalContacts.toLocaleString() ?? "0"} icon={Users} description="Identificados" />
        <StatCard title="Alertas activas" value={stats?.activeAlerts.toLocaleString() ?? "0"} icon={Bell} description="Estado: new" />
        <StatCard title="Acciones pend." value={stats?.totalActions.toLocaleString() ?? "0"} icon={Clock} description="Estado: pending" />
        <StatCard title="Entidades" value={stats?.totalEntities.toLocaleString() ?? "0"} icon={Brain} description="Knowledge graph" />
        <StatCard title="Hechos" value={stats?.totalFacts.toLocaleString() ?? "0"} icon={Activity} description="Extraidos" />
      </div>

      {/* Odoo tables */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Productos Odoo" value={stats?.totalOdooProducts.toLocaleString() ?? "0"} icon={Package} description="odoo_products" />
        <StatCard title="Lineas de Orden" value={stats?.totalOdooOrderLines.toLocaleString() ?? "0"} icon={ShoppingCart} description="odoo_order_lines" />
        <StatCard title="Usuarios Odoo" value={stats?.totalOdooUsers.toLocaleString() ?? "0"} icon={UserCog} description="odoo_users" />
      </div>

      {/* Sync Control Panel */}
      <SyncPanel onComplete={refreshData} />

      {/* Pipeline Runs */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Ejecuciones del Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineRuns.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Server className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No hay ejecuciones registradas del pipeline.
              </p>
            </div>
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
                    <TableHead className="text-right">Acciones</TableHead>
                    <TableHead>Errores</TableHead>
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
                              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              {run.run_type}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={cfg.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            <span title={formatDateTime(run.started_at)}>
                              {timeAgo(run.started_at)}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {run.duration_seconds != null
                              ? run.duration_seconds >= 60
                                ? `${Math.floor(run.duration_seconds / 60)}m ${Math.round(run.duration_seconds % 60)}s`
                                : `${Math.round(run.duration_seconds)}s`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{run.emails_processed}</TableCell>
                          <TableCell className="text-right tabular-nums">{run.alerts_generated}</TableCell>
                          <TableCell className="text-right tabular-nums">{run.actions_generated}</TableCell>
                          <TableCell>
                            {Array.isArray(run.errors) && run.errors.length > 0 ? (
                              <Badge variant="critical">{run.errors.length}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${run.id}-logs`}>
                            <TableCell colSpan={8}>
                              <div className="rounded-lg bg-muted/50 p-3 space-y-1 max-h-48 overflow-y-auto">
                                {logs.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">Sin logs para esta ejecucion.</p>
                                ) : (
                                  logs.map((log) => (
                                    <div key={log.id} className="flex items-start gap-2 text-xs">
                                      <Badge variant={log.level === "error" ? "critical" : log.level === "warning" ? "warning" : "secondary"} className="text-[10px] shrink-0">
                                        {log.level}
                                      </Badge>
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

      {/* Sync status */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Estado de Sincronizacion Gmail</CardTitle>
        </CardHeader>
        <CardContent>
          {syncStates.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Server className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No hay cuentas sincronizadas.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Emails sincronizados</TableHead>
                    <TableHead>History ID</TableHead>
                    <TableHead>Ultima actualizacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncStates.map((sync) => (
                    <TableRow key={sync.account}>
                      <TableCell className="font-medium">
                        {sync.account}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {sync.emails_synced.toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {sync.last_history_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span title={formatDateTime(sync.last_sync_at ?? sync.updated_at)}>
                          {timeAgo(sync.last_sync_at ?? sync.updated_at)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token Usage */}
      <TokenUsageCard />

      {/* Prediction Stats */}
      <PredictionStats />
    </div>
  );
}

// ── Token Usage Card ──
function TokenUsageCard() {
  const [usage, setUsage] = useState<{ endpoint: string; total_in: number; total_out: number; calls: number }[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      // Last 30 days aggregated by endpoint
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("token_usage")
        .select("endpoint, input_tokens, output_tokens")
        .gte("created_at", thirtyDaysAgo);

      if (!data || data.length === 0) {
        setLoading(false);
        return;
      }

      const map = new Map<string, { total_in: number; total_out: number; calls: number }>();
      let sumIn = 0;
      let sumOut = 0;
      for (const row of data) {
        const key = row.endpoint;
        if (!map.has(key)) map.set(key, { total_in: 0, total_out: 0, calls: 0 });
        const e = map.get(key)!;
        e.total_in += row.input_tokens;
        e.total_out += row.output_tokens;
        e.calls++;
        sumIn += row.input_tokens;
        sumOut += row.output_tokens;
      }

      setUsage(
        Array.from(map.entries())
          .map(([endpoint, v]) => ({ endpoint, ...v }))
          .sort((a, b) => b.total_in + b.total_out - (a.total_in + a.total_out))
      );
      setTotalIn(sumIn);
      setTotalOut(sumOut);
      setLoading(false);
    }
    fetch();
  }, []);

  if (loading) return <Skeleton className="h-[200px]" />;
  if (usage.length === 0) return null;

  // Rough cost estimate: Sonnet input $3/MTok, output $15/MTok
  const estimatedCost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Brain className="h-5 w-5 text-purple-500" />
        <CardTitle>Uso de Claude API (30 dias)</CardTitle>
        <Badge variant="secondary" className="ml-auto">
          ~${estimatedCost.toFixed(2)} USD
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{(totalIn / 1000).toFixed(1)}K</p>
            <p className="text-xs text-muted-foreground">Input tokens</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{(totalOut / 1000).toFixed(1)}K</p>
            <p className="text-xs text-muted-foreground">Output tokens</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{usage.reduce((s, u) => s + u.calls, 0)}</p>
            <p className="text-xs text-muted-foreground">Llamadas totales</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">Input tokens</TableHead>
                <TableHead className="text-right">Output tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.map((u) => (
                <TableRow key={u.endpoint}>
                  <TableCell className="font-medium">{u.endpoint}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.total_in.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.total_out.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
