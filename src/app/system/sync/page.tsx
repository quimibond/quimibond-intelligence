"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SyncCommand {
  id: string;
  command: string;
  status: string;
  requested_by: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface PipelineRun {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  emails_processed: number | null;
  alerts_generated: number | null;
  duration_seconds: number | null;
}

interface SyncFreshness {
  table_name: string;
  row_count: number;
  last_sync: string | null;
  expected_hours: number;
  minutes_ago: number | null;
  hours_ago: number | null;
  status: "fresh" | "warning" | "stale" | "unknown";
}

interface PushEvent {
  method: string;
  level: string;
  message: string;
  rows_pushed: number | null;
  elapsed_s: number | null;
  status: string | null;
  error: string | null;
  full_push: boolean | null;
  created_at: string;
}

export default function SyncPage() {
  const [commands, setCommands] = useState<SyncCommand[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [freshness, setFreshness] = useState<SyncFreshness[]>([]);
  const [pushEvents, setPushEvents] = useState<PushEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [cmdRes, runRes, freshRes, pushRes] = await Promise.all([
      supabase
        .from("sync_commands")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("pipeline_logs")
        .select("phase, level, message, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("odoo_sync_freshness")
        .select("table_name, row_count, last_sync, expected_hours, minutes_ago, hours_ago, status"),
      supabase
        .from("odoo_push_last_events")
        .select("method, level, message, rows_pushed, elapsed_s, status, error, full_push, created_at"),
    ]);
    setCommands((cmdRes.data ?? []) as SyncCommand[]);
    setPipelineRuns((runRes.data ?? []) as unknown as PipelineRun[]);
    setFreshness((freshRes.data ?? []) as SyncFreshness[]);
    setPushEvents((pushRes.data ?? []) as PushEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000); // refresh every 10s
    return () => clearInterval(interval);
  }, [fetchData]);

  const sendCommand = useCallback(async (command: string) => {
    setSending(command);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Comando enviado", {
          description: data.message,
        });
        fetchData();
      } else {
        toast.error("Error", { description: data.error });
      }
    } catch {
      toast.error("Error al enviar comando");
    } finally {
      setSending(null);
    }
  }, [fetchData]);

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "running": return <Loader2 className="h-4 w-4 text-info animate-spin" />;
      case "pending": return <Clock className="h-4 w-4 text-warning" />;
      case "error": case "failed": return <XCircle className="h-4 w-4 text-danger" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  // Formatea hours_ago/minutes_ago a un string humano (ej: "3 min", "2.1 h", "3.6 d")
  const fmtAgo = (minutesAgo: number | null, hoursAgo: number | null): string => {
    if (minutesAgo == null || hoursAgo == null) return "—";
    if (minutesAgo < 60) return `${Math.round(minutesAgo)} min`;
    if (hoursAgo < 48) return `${hoursAgo.toFixed(1)} h`;
    return `${(hoursAgo / 24).toFixed(1)} d`;
  };

  const freshnessBadge = (status: SyncFreshness["status"]) => {
    switch (status) {
      case "fresh": return <Badge variant="success">fresca</Badge>;
      case "warning": return <Badge variant="warning">lenta</Badge>;
      case "stale": return <Badge variant="critical">stale</Badge>;
      default: return <Badge variant="secondary">?</Badge>;
    }
  };

  const staleCount = freshness.filter(f => f.status === "stale").length;
  const warningCount = freshness.filter(f => f.status === "warning").length;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="flex gap-3"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /></div>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync & Pipeline"
        description="Control de sincronizacion Odoo↔Supabase y ejecucion de pipelines"
      />

      {/* ── Salud del sync Odoo → Supabase ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              Salud del sync Odoo → Supabase
              {staleCount > 0 && (
                <Badge variant="critical" className="text-[10px]">
                  {staleCount} tabla{staleCount !== 1 ? "s" : ""} stale
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="warning" className="text-[10px]">
                  {warningCount} lenta{warningCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {staleCount === 0 && warningCount === 0 && (
                <Badge variant="success" className="text-[10px]">todas OK</Badge>
              )}
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">
              SLA por tabla (hrs) vs ultimo row sincronizado
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {freshness.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Vista odoo_sync_freshness no disponible todavia. Aplicar migration 045.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tabla</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">SLA</TableHead>
                    <TableHead className="text-right">Hace</TableHead>
                    <TableHead>Ultimo evento push</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {freshness.map((f) => {
                    // Empata tabla ↔ metodo qb19 (odoo_sale_orders → sale_orders)
                    const methodName = f.table_name.replace(/^odoo_/, "");
                    const lastPush = pushEvents.find(e => e.method === methodName);
                    return (
                      <TableRow key={f.table_name}>
                        <TableCell className="font-mono text-xs">{f.table_name}</TableCell>
                        <TableCell>{freshnessBadge(f.status)}</TableCell>
                        <TableCell className="tabular-nums text-right">{f.row_count.toLocaleString()}</TableCell>
                        <TableCell className="tabular-nums text-right text-muted-foreground">{f.expected_hours}h</TableCell>
                        <TableCell className="tabular-nums text-right">
                          {fmtAgo(f.minutes_ago, f.hours_ago)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {lastPush ? (
                            <span className={lastPush.status === "error" ? "text-danger" : ""}>
                              {lastPush.status === "error"
                                ? `ERROR: ${(lastPush.error ?? "").slice(0, 60)}`
                                : `${lastPush.rows_pushed ?? 0} rows en ${Number(lastPush.elapsed_s ?? 0).toFixed(1)}s · ${timeAgo(lastPush.created_at)}`}
                              {lastPush.full_push && " · full"}
                            </span>
                          ) : (
                            <span className="text-[10px]">sin eventos (addon qb19 no parcheado)</span>
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

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => sendCommand("force_push")}
          disabled={sending !== null}
          className="gap-2"
        >
          {sending === "force_push" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUpFromLine className="h-4 w-4" />
          )}
          Push Odoo → Supabase
        </Button>
        <Button
          variant="outline"
          onClick={() => sendCommand("sync_contacts")}
          disabled={sending !== null}
          className="gap-2"
        >
          {sending === "sync_contacts" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-4 w-4" />
          )}
          Sync Contactos
        </Button>
        <Button
          variant="ghost"
          onClick={fetchData}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refrescar
        </Button>
      </div>

      {/* Sync Commands */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Comandos de Sync (Odoo)</CardTitle>
        </CardHeader>
        <CardContent>
          {commands.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay comandos registrados. Usa los botones de arriba para enviar uno.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Comando</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Enviado</TableHead>
                    <TableHead>Completado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commands.map((cmd) => (
                    <TableRow key={cmd.id}>
                      <TableCell>{statusIcon(cmd.status)}</TableCell>
                      <TableCell className="font-mono text-sm">{cmd.command}</TableCell>
                      <TableCell>
                        <Badge variant={
                          cmd.status === "completed" ? "success" :
                          cmd.status === "error" ? "critical" :
                          cmd.status === "running" ? "info" : "warning"
                        }>
                          {cmd.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {cmd.result ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {timeAgo(cmd.created_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {cmd.completed_at ? timeAgo(cmd.completed_at) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline Runs (Vercel)</CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay ejecuciones de pipeline registradas.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Emails</TableHead>
                    <TableHead>Alertas</TableHead>
                    <TableHead>Duracion</TableHead>
                    <TableHead>Inicio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipelineRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{statusIcon(run.status)}</TableCell>
                      <TableCell className="font-mono text-sm">{run.run_type}</TableCell>
                      <TableCell>
                        <Badge variant={
                          run.status === "completed" ? "success" :
                          run.status === "failed" || run.status === "error" ? "critical" :
                          run.status === "running" ? "info" : "secondary"
                        }>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{run.emails_processed ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{run.alerts_generated ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {run.duration_seconds ? `${run.duration_seconds}s` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {timeAgo(run.started_at)}
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
