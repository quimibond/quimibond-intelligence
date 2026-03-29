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
  Database,
  FileText,
  GitBranch,
  Mail,
  Package,
  Play,
  RefreshCw,
  Server,
  ShoppingCart,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  ChevronDown,
  XCircle,
  Zap,
  CreditCard,
  BarChart3,
  MessageSquare,
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
  // Core
  totalCompanies: number;
  totalContacts: number;
  // Communication
  totalEmails: number;
  totalThreads: number;
  // Knowledge Graph
  totalEntities: number;
  totalFacts: number;
  totalRelationships: number;
  // Intelligence
  activeAlerts: number;
  pendingActions: number;
  totalBriefings: number;
  // Metrics
  totalHealthScores: number;
  // Odoo
  totalOdooInvoices: number;
  totalOdooDeliveries: number;
  totalOdooPayments: number;
  totalOdooProducts: number;
  totalOdooOrderLines: number;
  totalOdooCrmLeads: number;
  totalOdooActivities: number;
  totalOdooUsers: number;
}

const statusConfig: Record<string, { variant: "success" | "warning" | "critical" | "info" | "secondary"; icon: typeof CheckCircle2 }> = {
  completed: { variant: "success", icon: CheckCircle2 },
  running: { variant: "info", icon: Activity },
  failed: { variant: "critical", icon: XCircle },
  partial: { variant: "warning", icon: AlertTriangle },
};

// ── Pipeline Trigger ──
function PipelineTrigger({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  async function triggerPipeline(steps: string[], label: string) {
    setRunning(label);
    setResult(null);
    try {
      const res = await fetch("/api/pipeline/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const succeeded = (data.steps ?? []).filter((s: { success: boolean }) => s.success).length;
      const failed = (data.steps ?? []).filter((s: { success: boolean }) => !s.success).length;
      const elapsed = data.total_elapsed_ms ? ` (${(data.total_elapsed_ms / 1000).toFixed(1)}s)` : "";

      if (failed > 0) {
        const errors = (data.steps ?? [])
          .filter((s: { success: boolean }) => !s.success)
          .map((s: { step: string; error: string }) => `${s.step}: ${s.error}`)
          .join(", ");
        setResult({ type: "error", msg: `${label}: ${succeeded} ok, ${failed} fallaron${elapsed} — ${errors}` });
        toast.error(`${label}: ${failed} pasos fallaron`);
      } else {
        setResult({ type: "success", msg: `${label}: ${succeeded} pasos completados${elapsed}` });
        toast.success(`${label} completado${elapsed}`);
      }
      onComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      setResult({ type: "error", msg: `${label}: ${msg}` });
      toast.error(`${label}: ${msg}`);
    } finally {
      setRunning(null);
    }
  }

  const pipelines = [
    { id: "all", label: "Pipeline Completo", desc: "sync → analyze → embeddings → briefing", icon: Zap, steps: ["all"], color: "blue" },
    { id: "sync", label: "Sync Emails", desc: "Descarga emails nuevos de Gmail", icon: Mail, steps: ["sync-emails"], color: "green" },
    { id: "analyze", label: "Analizar (Claude)", desc: "Extrae KG, alertas, acciones", icon: Brain, steps: ["analyze"], color: "purple" },
    { id: "embed", label: "Embeddings", desc: "Genera embeddings pgvector", icon: Database, steps: ["embeddings"], color: "amber" },
    { id: "brief", label: "Briefing", desc: "Genera briefing diario", icon: FileText, steps: ["briefing"], color: "cyan" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Play className="h-5 w-5 text-blue-500" />
        <CardTitle>Pipeline de Inteligencia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && (
          <div className={`rounded-lg p-3 text-sm ${result.type === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
            {result.msg}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {pipelines.map((p) => {
            const Icon = p.icon;
            const isRunning = running === p.label;
            return (
              <button
                key={p.id}
                onClick={() => triggerPipeline(p.steps, p.label)}
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

// ── Odoo Command Dispatcher ──
async function sendOdooCommand(command: string): Promise<string> {
  const { data, error } = await supabase
    .from("sync_commands")
    .insert({ command, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

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
  }
  return "Enviado a Odoo (revisa logs para resultado)";
}

// ── Maintenance Panel ──
function MaintenancePanel({ onComplete }: { onComplete: () => void }) {
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
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Error desconocido";
      setResult({ type: "error", msg: `${label}: ${errMsg}` });
      toast.error(`${label}: ${errMsg}`);
    } finally {
      setRunning(null);
    }
  }

  const dbActions: { id: string; label: string; desc: string; icon: typeof RefreshCw; fn: () => Promise<string> }[] = [
    {
      id: "resolve_connections",
      label: "Resolver Conexiones",
      desc: "Vincula emails→contactos, threads→empresas, entity_id",
      icon: GitBranch,
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
      label: "Recalcular Stats Contactos",
      desc: "total_sent, total_received, last_activity",
      icon: Users,
      fn: async () => {
        const { error } = await supabase.rpc("refresh_contact_360");
        if (error) throw error;
        return "Stats actualizados";
      },
    },
    {
      id: "resolve_assignees",
      label: "Resolver Asignados",
      desc: "assignee_name → email de odoo_users",
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
      desc: "emails.recipient → contactos",
      icon: Mail,
      fn: async () => {
        const { data, error } = await supabase.rpc("resolve_email_recipients");
        if (error) throw error;
        const r = data as { total_addresses_parsed: number; resolved_to_contacts: number };
        return `${r.resolved_to_contacts} de ${r.total_addresses_parsed} resueltos`;
      },
    },
    {
      id: "refresh_network",
      label: "Refrescar Red",
      desc: "Recalcula red de comunicacion",
      icon: RefreshCw,
      fn: async () => {
        const { data, error } = await supabase.rpc("refresh_communication_edges");
        if (error) throw error;
        const r = data as { edges_created: number; bidirectional_marked: number };
        return `${r.edges_created} conexiones, ${r.bidirectional_marked} bidireccionales`;
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
  ];

  const odooActions: { id: string; label: string; desc: string; icon: typeof RefreshCw; command: string }[] = [
    {
      id: "odoo_tables",
      label: "Sync 8 Tablas Odoo",
      desc: "Facturas, pagos, entregas, CRM, actividades, equipo",
      icon: Server,
      command: "run_sync_odoo_tables",
    },
    {
      id: "odoo_enrich",
      label: "Sync Partners (Odoo)",
      desc: "Partners + empresas con datos financieros",
      icon: Users,
      command: "run_enrich_only",
    },
    {
      id: "odoo_scores",
      label: "Recalcular Scores",
      desc: "Health scores, risk level, sentiment",
      icon: TrendingUp,
      command: "run_update_scores",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <RefreshCw className="h-5 w-5 text-emerald-500" />
        <CardTitle>Mantenimiento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {result && (
          <div className={`rounded-lg p-3 text-sm ${result.type === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
            {result.msg}
          </div>
        )}

        {/* Database maintenance */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold">Base de datos</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {dbActions.map((action) => {
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
        </div>

        {/* Odoo commands */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Ejecutar en Odoo</h3>
            <span className="text-xs text-muted-foreground">(se envia comando via sync_commands)</span>
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
      async function safeCount(table: string, filter?: { col: string; val: string }) {
        let query = supabase.from(table).select("id", { count: "exact", head: true });
        if (filter) query = query.eq(filter.col, filter.val);
        const { count } = await query;
        return count ?? 0;
      }

      const [
        totalCompanies, totalContacts,
        totalEmails, totalThreads,
        totalEntities, totalFacts, totalRelationships,
        activeAlerts, pendingActions, totalBriefings,
        totalHealthScores,
        totalOdooInvoices, totalOdooDeliveries, totalOdooPayments,
        totalOdooProducts, totalOdooOrderLines, totalOdooCrmLeads,
        totalOdooActivities, totalOdooUsers,
        syncRes, pipelineRes,
      ] = await Promise.all([
        // Core
        safeCount("companies"),
        safeCount("contacts"),
        // Communication
        safeCount("emails"),
        safeCount("threads"),
        // Knowledge Graph
        safeCount("entities"),
        safeCount("facts"),
        safeCount("entity_relationships"),
        // Intelligence
        safeCount("alerts", { col: "state", val: "new" }),
        safeCount("action_items", { col: "state", val: "pending" }),
        safeCount("briefings"),
        // Metrics
        safeCount("health_scores"),
        // Odoo
        safeCount("odoo_invoices"),
        safeCount("odoo_deliveries"),
        safeCount("odoo_payments"),
        safeCount("odoo_products"),
        safeCount("odoo_order_lines"),
        safeCount("odoo_crm_leads"),
        safeCount("odoo_activities"),
        safeCount("odoo_users"),
        // System
        supabase.from("sync_state").select("*").order("last_sync_at", { ascending: false }),
        supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(20),
      ]);

      setStats({
        totalCompanies, totalContacts,
        totalEmails, totalThreads,
        totalEntities, totalFacts, totalRelationships,
        activeAlerts, pendingActions, totalBriefings,
        totalHealthScores,
        totalOdooInvoices, totalOdooDeliveries, totalOdooPayments,
        totalOdooProducts, totalOdooOrderLines, totalOdooCrmLeads,
        totalOdooActivities, totalOdooUsers,
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sistema" description="Estado del sistema, pipeline y sincronizacion" />

      {/* Core + Communication */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Core y Comunicacion</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Empresas" value={stats?.totalCompanies.toLocaleString() ?? "0"} icon={Database} description="companies" />
          <StatCard title="Contactos" value={stats?.totalContacts.toLocaleString() ?? "0"} icon={Users} description="contacts" />
          <StatCard title="Emails" value={stats?.totalEmails.toLocaleString() ?? "0"} icon={Mail} description="emails" />
          <StatCard title="Threads" value={stats?.totalThreads.toLocaleString() ?? "0"} icon={MessageSquare} description="threads" />
        </div>
      </div>

      {/* Knowledge Graph + Intelligence */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Knowledge Graph e Inteligencia</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          <StatCard title="Entidades" value={stats?.totalEntities.toLocaleString() ?? "0"} icon={Brain} description="entities" />
          <StatCard title="Hechos" value={stats?.totalFacts.toLocaleString() ?? "0"} icon={Activity} description="facts" />
          <StatCard title="Relaciones" value={stats?.totalRelationships.toLocaleString() ?? "0"} icon={GitBranch} description="entity_relationships" />
          <StatCard title="Alertas activas" value={stats?.activeAlerts.toLocaleString() ?? "0"} icon={Bell} description="state: new" />
          <StatCard title="Acciones pend." value={stats?.pendingActions.toLocaleString() ?? "0"} icon={Clock} description="state: pending" />
          <StatCard title="Briefings" value={stats?.totalBriefings.toLocaleString() ?? "0"} icon={FileText} description="briefings" />
          <StatCard title="Health Scores" value={stats?.totalHealthScores.toLocaleString() ?? "0"} icon={TrendingUp} description="health_scores" />
        </div>
      </div>

      {/* Odoo tables */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Datos de Odoo</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturas" value={stats?.totalOdooInvoices.toLocaleString() ?? "0"} icon={CreditCard} description="odoo_invoices" />
          <StatCard title="Entregas" value={stats?.totalOdooDeliveries.toLocaleString() ?? "0"} icon={Truck} description="odoo_deliveries" />
          <StatCard title="Pagos" value={stats?.totalOdooPayments.toLocaleString() ?? "0"} icon={BarChart3} description="odoo_payments" />
          <StatCard title="CRM Leads" value={stats?.totalOdooCrmLeads.toLocaleString() ?? "0"} icon={TrendingUp} description="odoo_crm_leads" />
          <StatCard title="Productos" value={stats?.totalOdooProducts.toLocaleString() ?? "0"} icon={Package} description="odoo_products" />
          <StatCard title="Lineas de Orden" value={stats?.totalOdooOrderLines.toLocaleString() ?? "0"} icon={ShoppingCart} description="odoo_order_lines" />
          <StatCard title="Actividades" value={stats?.totalOdooActivities.toLocaleString() ?? "0"} icon={CheckCircle2} description="odoo_activities" />
          <StatCard title="Usuarios" value={stats?.totalOdooUsers.toLocaleString() ?? "0"} icon={UserCog} description="odoo_users" />
        </div>
      </div>

      {/* Pipeline Trigger */}
      <PipelineTrigger onComplete={refreshData} />

      {/* Maintenance Panel */}
      <MaintenancePanel onComplete={refreshData} />

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
              <p className="text-sm text-muted-foreground">No hay ejecuciones registradas.</p>
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
                              : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{run.emails_processed}</TableCell>
                          <TableCell className="text-right tabular-nums">{run.alerts_generated}</TableCell>
                          <TableCell className="text-right tabular-nums">{run.actions_generated}</TableCell>
                          <TableCell>
                            {Array.isArray(run.errors) && run.errors.length > 0 ? (
                              <Badge variant="critical">{run.errors.length}</Badge>
                            ) : (
                              <span className="text-muted-foreground">\u2014</span>
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
          <Mail className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Estado de Sincronizacion Gmail</CardTitle>
        </CardHeader>
        <CardContent>
          {syncStates.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Server className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No hay cuentas sincronizadas.</p>
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
                      <TableCell className="font-medium">{sync.account}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{sync.emails_synced.toLocaleString()}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {sync.last_history_id ?? "\u2014"}
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
    async function load() {
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
    load();
  }, []);

  if (loading) return <Skeleton className="h-[200px]" />;
  if (usage.length === 0) return null;

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
