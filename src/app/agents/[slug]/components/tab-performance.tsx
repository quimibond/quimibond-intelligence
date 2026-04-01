"use client";

import { useMemo } from "react";
import { Activity, Brain, DollarSign, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIAgent, AgentRun, AgentInsight } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Helpers ──

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-danger",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground/40",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const STATE_COLORS: Record<string, string> = {
  new: "bg-info",
  seen: "bg-warning",
  acted_on: "bg-success",
  dismissed: "bg-muted-foreground/40",
  expired: "bg-muted-foreground/20",
};

const STATE_LABELS: Record<string, string> = {
  new: "Nuevo",
  seen: "Visto",
  acted_on: "Actuado",
  dismissed: "Descartado",
  expired: "Expirado",
};

// Cost estimate: Claude 3.5 Sonnet pricing approx
const INPUT_COST_PER_1K = 0.003;
const OUTPUT_COST_PER_1K = 0.015;

// ── Component ──

interface Props {
  agent: AIAgent;
  runs: AgentRun[];
  insights: AgentInsight[];
}

export function TabPerformance({ agent, runs, insights }: Props) {
  const stats = useMemo(() => {
    const totalRuns = runs.length;
    const successRuns = runs.filter((r) => r.status === "completed").length;
    const successRate = pct(successRuns, totalRuns);
    const totalInsights = insights.length;
    const confidences = insights
      .map((i) => i.confidence)
      .filter((c): c is number => c != null);
    const avgConfidence =
      confidences.length > 0
        ? Math.round(
            (confidences.reduce((s, v) => s + v, 0) / confidences.length) * 100
          )
        : 0;

    const totalInputTokens = runs.reduce(
      (s, r) => s + (r.input_tokens ?? 0),
      0
    );
    const totalOutputTokens = runs.reduce(
      (s, r) => s + (r.output_tokens ?? 0),
      0
    );
    const estimatedCost =
      (totalInputTokens / 1000) * INPUT_COST_PER_1K +
      (totalOutputTokens / 1000) * OUTPUT_COST_PER_1K;

    // Severity distribution
    const bySeverity: Record<string, number> = {};
    for (const i of insights) {
      const sev = i.severity ?? "low";
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }

    // State distribution
    const byState: Record<string, number> = {};
    for (const i of insights) {
      const st = i.state ?? "new";
      byState[st] = (byState[st] ?? 0) + 1;
    }

    return {
      totalRuns,
      successRate,
      totalInsights,
      avgConfidence,
      totalInputTokens,
      totalOutputTokens,
      estimatedCost,
      bySeverity,
      byState,
    };
  }, [runs, insights]);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Activity className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
            <p className="text-2xl font-bold tabular-nums">
              {stats.totalRuns}
            </p>
            <p className="text-xs text-muted-foreground">Total Corridas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Target className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                stats.successRate >= 80
                  ? "text-success-foreground"
                  : stats.successRate >= 50
                  ? "text-warning-foreground"
                  : "text-danger-foreground"
              )}
            >
              {stats.successRate}%
            </p>
            <p className="text-xs text-muted-foreground">Tasa de Exito</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Zap className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
            <p className="text-2xl font-bold tabular-nums">
              {stats.totalInsights}
            </p>
            <p className="text-xs text-muted-foreground">Insights Generados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Brain className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
            <p className="text-2xl font-bold tabular-nums">
              {stats.avgConfidence}%
            </p>
            <p className="text-xs text-muted-foreground">Confianza Prom.</p>
          </CardContent>
        </Card>
      </div>

      {/* Token usage */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Uso de Tokens</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold tabular-nums">
                {stats.totalInputTokens.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Input Tokens</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">
                {stats.totalOutputTokens.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Output Tokens</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums text-warning-foreground">
                ${stats.estimatedCost.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">Costo Estimado</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Distributions */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* By severity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Insights por Severidad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.totalInsights === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Sin insights generados
              </p>
            ) : (
              ["critical", "high", "medium", "low"].map((sev) => {
                const count = stats.bySeverity[sev] ?? 0;
                const width = pct(count, stats.totalInsights);
                return (
                  <div key={sev} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>{SEVERITY_LABELS[sev] ?? sev}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          SEVERITY_COLORS[sev] ?? "bg-muted-foreground/40"
                        )}
                        style={{ width: `${Math.max(width, count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* By state */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Insights por Estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.totalInsights === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Sin insights generados
              </p>
            ) : (
              ["new", "seen", "acted_on", "dismissed", "expired"].map((st) => {
                const count = stats.byState[st] ?? 0;
                const width = pct(count, stats.totalInsights);
                return (
                  <div key={st} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>{STATE_LABELS[st] ?? st}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          STATE_COLORS[st] ?? "bg-muted-foreground/40"
                        )}
                        style={{ width: `${Math.max(width, count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
