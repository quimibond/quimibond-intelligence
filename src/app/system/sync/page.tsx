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

export default function SyncPage() {
  const [commands, setCommands] = useState<SyncCommand[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [cmdRes, runRes] = await Promise.all([
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
    ]);
    setCommands((cmdRes.data ?? []) as SyncCommand[]);
    setPipelineRuns((runRes.data ?? []) as unknown as PipelineRun[]);
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
