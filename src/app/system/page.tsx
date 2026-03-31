"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowUpFromLine,
  Bell,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Database,
  FileText,
  GitBranch,
  Mail,
  MessageSquare,
  Package,
  Play,
  RefreshCw,
  Server,
  ShoppingCart,
  Truck,
  TrendingUp,
  UserCog,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import type { PipelineRun } from "@/lib/types";
import { DataFreshness } from "@/components/shared/data-freshness";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// ── Types ──

interface SystemStats {
  totalCompanies: number;
  totalContacts: number;
  totalEmails: number;
  totalThreads: number;
  totalEntities: number;
  totalFacts: number;
  totalRelationships: number;
  activeAlerts: number;
  pendingActions: number;
  totalBriefings: number;
  totalHealthScores: number;
  totalOdooInvoices: number;
  totalOdooDeliveries: number;
  totalOdooPayments: number;
  totalOdooProducts: number;
  totalOdooOrderLines: number;
  totalOdooCrmLeads: number;
  totalOdooActivities: number;
  totalOdooUsers: number;
}

interface SyncCommand {
  id: string;
  command: string;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

const statusConfig: Record<string, { variant: "success" | "warning" | "critical" | "info" | "secondary"; icon: typeof CheckCircle2 }> = {
  completed: { variant: "success", icon: CheckCircle2 },
  running: { variant: "info", icon: Activity },
  failed: { variant: "critical", icon: XCircle },
  partial: { variant: "warning", icon: AlertTriangle },
  pending: { variant: "warning", icon: Clock },
  error: { variant: "critical", icon: XCircle },
};

// ── Pipeline Trigger ──

function PipelineTrigger({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);

  async function trigger(steps: string[], label: string) {
    setRunning(label);
    try {
      // Call endpoints directly instead of via trigger (avoids double timeout)
      let data: Record<string, unknown> = {};
      let res: Response;

      if (steps.length === 1 && steps[0] === "cycle-quick") {
        res = await fetch("/api/cycle/run?type=quick");
      } else if (steps.length === 1 && steps[0] === "cycle-full") {
        res = await fetch("/api/cycle/run?type=full");
      } else if (steps.length === 1 && steps[0] === "cycle-daily") {
        res = await fetch("/api/cycle/run?type=daily");
      } else if (steps.length === 1 && steps[0] === "orchestrate") {
        res = await fetch("/api/agents/orchestrate", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "learn") {
        res = await fetch("/api/agents/learn", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "evolve") {
        res = await fetch("/api/agents/evolve", { method: "POST" });
      } else if (steps.length === 1 && steps[0] !== "all") {
        // Direct call to specific pipeline endpoint
        res = await fetch(`/api/pipeline/${steps[0]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        data = await res.json();
      } else {
        // For "all" or multi-step, use trigger
        res = await fetch("/api/pipeline/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps }),
        });
        data = await res.json();
      }

      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);

      const elapsed = data.total_elapsed_ms ? ` (${(Number(data.total_elapsed_ms) / 1000).toFixed(1)}s)` :
                      data.elapsed_s ? ` (${data.elapsed_s}s)` : "";
      toast.success(`${label} completado${elapsed}`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  const pipelines = [
    { id: "quick", label: "Ciclo Rapido", desc: "Extract → Heal → Validate", icon: Zap, steps: ["cycle-quick"] },
    { id: "analyze", label: "Analizar Emails", desc: "Procesar 1 cuenta", icon: Mail, steps: ["analyze"] },
    { id: "agents", label: "Agentes IA", desc: "Generar insights", icon: Brain, steps: ["orchestrate"] },
    { id: "learn", label: "Aprender", desc: "Feedback → memorias", icon: TrendingUp, steps: ["learn"] },
    { id: "health", label: "Health Scores", desc: "Recalcular scores", icon: CheckCircle2, steps: ["health-scores"] },
    { id: "evolve", label: "Evolucionar", desc: "Mejoras de schema", icon: Database, steps: ["evolve"] },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Play className="h-5 w-5 text-blue-500" />
        <CardTitle className="text-base">Pipeline de Inteligencia (Vercel)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {pipelines.map((p) => {
            const Icon = p.icon;
            const isRunning = running === p.label;
            return (
              <button
                key={p.id}
                onClick={() => trigger(p.steps, p.label)}
                disabled={running !== null}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                )}
              >
                {isRunning ? (
                  <RefreshCw className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                ) : (
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Odoo Sync Trigger ──

function OdooSyncTrigger({ onComplete }: { onComplete: () => void }) {
  const [sending, setSending] = useState<string | null>(null);

  async function sendCommand(command: string, label: string) {
    setSending(command);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(label, { description: data.message });
        onComplete();
      } else {
        toast.error(label, { description: data.error });
      }
    } catch {
      toast.error(`${label}: Error de conexion`);
    } finally {
      setSending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Server className="h-5 w-5 text-amber-500" />
        <CardTitle className="text-base">Sync Odoo ↔ Supabase</CardTitle>
        <span className="text-xs text-muted-foreground ml-2">
          Odoo ejecuta cada 5min (pull) y 1h (push)
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => sendCommand("force_push", "Push Odoo → Supabase")}
            disabled={sending !== null}
            className="gap-2"
          >
            {sending === "force_push" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4" />}
            Push Odoo → Supabase
          </Button>
          <Button
            variant="outline"
            onClick={() => sendCommand("sync_contacts", "Sync Contactos")}
            disabled={sending !== null}
            className="gap-2"
          >
            {sending === "sync_contacts" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Sync Contactos
          </Button>
          <Link href="/system/sync">
            <Button variant="ghost" className="gap-2">
              <Activity className="h-4 w-4" />
              Ver historial completo
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── DB Maintenance ──

function MaintenancePanel({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);

  async function runRPC(id: string, label: string, rpcName: string) {
    setRunning(id);
    try {
      const { data, error } = await supabase.rpc(rpcName);
      if (error) throw error;
      const result = typeof data === "object" && data !== null
        ? Object.entries(data as Record<string, number>).map(([k, v]) => `${k}=${v}`).join(", ")
        : String(data ?? "OK");
      toast.success(`${label}: ${result}`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  async function runEnrich(id: string, label: string, type: string) {
    setRunning(id);
    try {
      const res = await fetch("/api/enrich/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, limit: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast.success(`${label}: ${data.enriched ?? 0} enriquecidos`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  const actions = [
    { id: "resolve", label: "Resolver Conexiones", desc: "emails↔contactos, threads↔empresas", icon: GitBranch, fn: () => runRPC("resolve", "Resolver Conexiones", "resolve_all_connections") },
    { id: "refresh_360", label: "Stats Contactos", desc: "total_sent, total_received", icon: Users, fn: () => runRPC("refresh_360", "Stats Contactos", "refresh_contact_360") },
    { id: "enrich_c", label: "Enriquecer Contactos", desc: "Perfiles IA (5 contactos)", icon: Brain, fn: () => runEnrich("enrich_c", "Enriquecer Contactos", "contacts") },
    { id: "enrich_co", label: "Enriquecer Empresas", desc: "Perfiles IA (5 empresas)", icon: Brain, fn: () => runEnrich("enrich_co", "Enriquecer Empresas", "companies") },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <RefreshCw className="h-5 w-5 text-emerald-500" />
        <CardTitle className="text-base">Mantenimiento</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((a) => {
            const Icon = a.icon;
            const isRunning = running === a.id;
            return (
              <button
                key={a.id}
                onClick={a.fn}
                disabled={running !== null}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                )}
              >
                {isRunning ? <RefreshCw className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" /> : <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Token Usage ──

function TokenUsageCard() {
  const [usage, setUsage] = useState<{ endpoint: string; total_in: number; total_out: number; calls: number }[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("token_usage")
        .select("endpoint, input_tokens, output_tokens")
        .gte("created_at", thirtyDaysAgo);

      if (!data || data.length === 0) { setLoading(false); return; }

      const map = new Map<string, { total_in: number; total_out: number; calls: number }>();
      let sumIn = 0, sumOut = 0;
      for (const row of data) {
        if (!map.has(row.endpoint)) map.set(row.endpoint, { total_in: 0, total_out: 0, calls: 0 });
        const e = map.get(row.endpoint)!;
        e.total_in += row.input_tokens;
        e.total_out += row.output_tokens;
        e.calls++;
        sumIn += row.input_tokens;
        sumOut += row.output_tokens;
      }
      setUsage(Array.from(map.entries()).map(([endpoint, v]) => ({ endpoint, ...v })).sort((a, b) => b.total_in + b.total_out - (a.total_in + a.total_out)));
      setTotalIn(sumIn);
      setTotalOut(sumOut);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Skeleton className="h-[200px]" />;
  if (usage.length === 0) return null;

  const estimatedCost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Brain className="h-5 w-5 text-purple-500" />
        <CardTitle className="text-base">Claude API (30 dias)</CardTitle>
        <Badge variant="secondary" className="ml-auto">~${estimatedCost.toFixed(2)} USD</Badge>
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
            <p className="text-xs text-muted-foreground">Llamadas</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
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
            <Server className="h-5 w-5 text-amber-500" />
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
    </div>
  );
}
