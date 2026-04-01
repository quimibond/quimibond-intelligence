"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import type { AgentRun } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

// ── Helpers ──

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Completado
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="critical" className="gap-1">
          <XCircle className="h-3 w-3" />
          Fallido
        </Badge>
      );
    case "running":
      return (
        <Badge variant="warning" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Ejecutando
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTokens(input: number | null, output: number | null): string {
  const i = input ?? 0;
  const o = output ?? 0;
  if (i === 0 && o === 0) return "--";
  return `${(i / 1000).toFixed(1)}k / ${(o / 1000).toFixed(1)}k`;
}

// ── Component ──

interface Props {
  runs: AgentRun[];
}

export function TabRuns({ runs }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Sin corridas"
        description="Este agente no ha sido ejecutado todavia"
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Ultimas {runs.length} corridas
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Trigger</th>
                <th className="px-4 py-2 text-left font-medium">Inicio</th>
                <th className="px-4 py-2 text-right font-medium">Duracion</th>
                <th className="px-4 py-2 text-right font-medium">Entidades</th>
                <th className="px-4 py-2 text-right font-medium">Insights</th>
                <th className="px-4 py-2 text-right font-medium">
                  Tokens (in/out)
                </th>
                <th className="px-4 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const isExpanded = expandedId === run.id;
                const hasFailed = run.status === "failed" && run.error_message;
                return (
                  <tr
                    key={run.id}
                    className={cn(
                      "border-b last:border-0 transition-colors",
                      hasFailed
                        ? "cursor-pointer hover:bg-muted/50"
                        : ""
                    )}
                    onClick={() => {
                      if (hasFailed) {
                        setExpandedId(isExpanded ? null : run.id);
                      }
                    }}
                  >
                    <td className="px-4 py-2.5">{statusBadge(run.status)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">
                        {run.trigger_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {run.started_at ? timeAgo(run.started_at) : "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatDuration(run.duration_seconds)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {run.entities_analyzed ?? "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {run.insights_generated ?? "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatTokens(run.input_tokens, run.output_tokens)}
                    </td>
                    <td className="px-4 py-2.5">
                      {hasFailed && (
                        isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="md:hidden divide-y">
          {runs.map((run) => {
            const isExpanded = expandedId === run.id;
            const hasFailed = run.status === "failed" && run.error_message;
            return (
              <div
                key={run.id}
                className={cn("p-3 space-y-2", hasFailed && "cursor-pointer")}
                onClick={() => {
                  if (hasFailed) {
                    setExpandedId(isExpanded ? null : run.id);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  {statusBadge(run.status)}
                  <span className="text-xs text-muted-foreground">
                    {run.started_at ? timeAgo(run.started_at) : "--"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {run.trigger_type}
                  </Badge>
                  <span className="tabular-nums">
                    {formatDuration(run.duration_seconds)}
                  </span>
                  <span className="tabular-nums">
                    {run.insights_generated ?? 0} insights
                  </span>
                </div>
                {isExpanded && run.error_message && (
                  <div className="rounded-md bg-danger/10 p-2.5 text-xs text-danger-foreground">
                    {run.error_message}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Expanded error row for desktop */}
        {expandedId != null && (
          <div className="hidden md:block">
            {runs
              .filter(
                (r) => r.id === expandedId && r.error_message
              )
              .map((run) => (
                <div
                  key={`err-${run.id}`}
                  className="border-t px-4 py-3 bg-danger/5"
                >
                  <p className="text-xs font-medium text-danger-foreground mb-1">
                    Error:
                  </p>
                  <p className="text-xs text-danger-foreground whitespace-pre-wrap">
                    {run.error_message}
                  </p>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
