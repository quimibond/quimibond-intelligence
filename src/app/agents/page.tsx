"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Play, Loader2, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, DollarSign, Truck, Users, Shield, Rocket, Brain,
  Eye, ThumbsUp, ThumbsDown, RefreshCw, Zap,
} from "lucide-react";

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  sales: TrendingUp,
  finance: DollarSign,
  operations: Truck,
  relationships: Users,
  risk: Shield,
  growth: Rocket,
  meta: Brain,
};

const DOMAIN_COLORS: Record<string, string> = {
  sales: "text-emerald-500",
  finance: "text-amber-500",
  operations: "text-blue-500",
  relationships: "text-purple-500",
  risk: "text-red-500",
  growth: "text-cyan-500",
  meta: "text-indigo-500",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  low: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  info: "bg-gray-500/15 text-gray-600 border-gray-500/30",
};

interface AgentOverview {
  agent_id: number;
  slug: string;
  name: string;
  domain: string;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  total_runs: number;
  total_insights: number;
  new_insights: number;
  avg_confidence: number | null;
}

interface Insight {
  id: number;
  agent_id: number;
  insight_type: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  confidence: number;
  business_impact_estimate: number | null;
  state: string;
  created_at: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const load = useCallback(async () => {
    const [agentsRes, insightsRes] = await Promise.all([
      supabase.rpc("get_agents_overview"),
      supabase
        .from("agent_insights")
        .select("id, agent_id, insight_type, category, severity, title, description, recommendation, confidence, business_impact_estimate, state, created_at")
        .in("state", ["new", "seen"])
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setAgents(agentsRes.data ?? []);
    setInsights(insightsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRun(slug: string) {
    setRunningAgent(slug);
    try {
      await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_slug: slug }),
      });
      await load();
    } finally {
      setRunningAgent(null);
    }
  }

  async function handleRunAll() {
    setRunningAll(true);
    try {
      await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_all: true }),
      });
      await load();
    } finally {
      setRunningAll(false);
    }
  }

  async function updateInsightState(id: number, state: string) {
    await supabase.from("agent_insights").update({ state, was_useful: state === "acted_on" }).eq("id", id);
    setInsights(prev => prev.filter(i => i.id !== id));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agentes de IA" description="Sistema multi-agente de inteligencia autonoma" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[180px]" />)}
        </div>
      </div>
    );
  }

  const totalInsights = agents.reduce((s, a) => s + a.total_insights, 0);
  const newInsights = agents.reduce((s, a) => s + a.new_insights, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Agentes de IA"
          description={`${agents.length} agentes activos — ${totalInsights} insights generados, ${newInsights} nuevos`}
        />
        <Button
          onClick={handleRunAll}
          disabled={runningAll || runningAgent !== null}
          className="shrink-0"
        >
          {runningAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Ejecutar Todos
        </Button>
      </div>

      {/* Agent Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((agent) => {
          const Icon = DOMAIN_ICONS[agent.domain] ?? Bot;
          const color = DOMAIN_COLORS[agent.domain] ?? "text-muted-foreground";
          const isRunning = runningAgent === agent.slug;

          return (
            <Card key={agent.slug} className="relative overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-5 w-5", color)} />
                    <CardTitle className="text-sm font-semibold">{agent.name}</CardTitle>
                  </div>
                  {agent.is_active ? (
                    <span className="h-2 w-2 rounded-full bg-emerald-500" title="Activo" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-gray-400" title="Inactivo" />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Corridas</p>
                    <p className="font-semibold">{agent.total_runs}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Insights</p>
                    <p className="font-semibold">
                      {agent.total_insights}
                      {agent.new_insights > 0 && (
                        <span className="ml-1 text-xs text-emerald-500">+{agent.new_insights}</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Confianza</p>
                    <p className="font-semibold">{agent.avg_confidence != null ? `${(agent.avg_confidence * 100).toFixed(0)}%` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Ultima corrida</p>
                    <p className="font-semibold text-xs">{agent.last_run_at ? timeAgo(agent.last_run_at) : "nunca"}</p>
                  </div>
                </div>

                {agent.last_run_status && (
                  <div className="flex items-center gap-1.5 text-xs">
                    {agent.last_run_status === "completed" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : agent.last_run_status === "failed" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                    )}
                    <span className="text-muted-foreground capitalize">{agent.last_run_status}</span>
                  </div>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleRun(agent.slug)}
                  disabled={isRunning || runningAll}
                >
                  {isRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {isRunning ? "Analizando..." : "Ejecutar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Insights Feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Insights Recientes ({insights.length})
            </h2>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Actualizar
          </Button>
        </div>

        {insights.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No hay insights pendientes. Ejecuta un agente para generar analisis.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {insights.map((insight) => {
              const agent = agents.find(a => a.agent_id === insight.agent_id);
              const AgentIcon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;

              return (
                <Card key={insight.id} className="transition-colors hover:bg-muted/30">
                  <CardContent className="py-3">
                    <div className="flex items-start gap-3">
                      <AgentIcon className={cn("h-4 w-4 mt-0.5 shrink-0", DOMAIN_COLORS[agent?.domain ?? ""])} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{insight.title}</span>
                          <Badge className={cn("text-[10px] px-1.5", SEVERITY_COLORS[insight.severity])}>
                            {insight.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5">
                            {insight.insight_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {(insight.confidence * 100).toFixed(0)}% confianza
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{insight.description}</p>
                        {insight.recommendation && (
                          <p className="text-sm text-foreground/80">
                            <span className="font-medium">Accion:</span> {insight.recommendation}
                          </p>
                        )}
                        {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Impacto estimado: ${insight.business_impact_estimate.toLocaleString()} MXN
                          </p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-muted-foreground">{timeAgo(insight.created_at)}</span>
                          <span className="text-[10px] text-muted-foreground">· {agent?.name}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => updateInsightState(insight.id, "acted_on")}
                          title="Util / Actuar"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          onClick={() => updateInsightState(insight.id, "dismissed")}
                          title="Descartar"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:bg-muted"
                          onClick={() => updateInsightState(insight.id, "seen")}
                          title="Marcar como visto"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
