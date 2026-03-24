"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Brain,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  Server,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, timeAgo } from "@/lib/utils";
import type { PipelineRun, SyncState } from "@/lib/types";
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

interface SystemStats {
  totalEmails: number;
  totalContacts: number;
  activeAlerts: number;
  totalEntities: number;
  totalFacts: number;
  totalActions: number;
}

const statusConfig: Record<string, { variant: "success" | "warning" | "critical" | "info" | "secondary"; icon: typeof CheckCircle2 }> = {
  completed: { variant: "success", icon: CheckCircle2 },
  running: { variant: "info", icon: Activity },
  failed: { variant: "critical", icon: XCircle },
  partial: { variant: "warning", icon: AlertTriangle },
};

export default function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [emailsRes, contactsRes, alertsRes, entitiesRes, factsRes, actionsRes, syncRes, pipelineRes] =
        await Promise.all([
          supabase.from("emails").select("id", { count: "exact", head: true }),
          supabase.from("contacts").select("id", { count: "exact", head: true }),
          supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
          supabase.from("entities").select("id", { count: "exact", head: true }),
          supabase.from("facts").select("id", { count: "exact", head: true }),
          supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
          supabase.from("sync_state").select("*").order("last_sync_at", { ascending: false }),
          supabase.from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(20),
        ]);

      setStats({
        totalEmails: emailsRes.count ?? 0,
        totalContacts: contactsRes.count ?? 0,
        activeAlerts: alertsRes.count ?? 0,
        totalEntities: entitiesRes.count ?? 0,
        totalFacts: factsRes.count ?? 0,
        totalActions: actionsRes.count ?? 0,
      });

      setSyncStates((syncRes.data ?? []) as SyncState[]);
      setPipelineRuns((pipelineRes.data ?? []) as PipelineRun[]);
      setLoading(false);
    }
    fetchData();
  }, []);

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
            <div className="rounded-md border">
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
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.run_type}</TableCell>
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
            <div className="rounded-md border">
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
    </div>
  );
}
