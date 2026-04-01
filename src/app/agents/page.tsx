"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight, Bot, Brain, CheckCircle2, Database, DollarSign,
  Loader2, Play, Rocket, Server, Shield, TrendingUp, Truck,
  Users, XCircle, Zap,
} from "lucide-react";

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  sales: TrendingUp, finance: DollarSign, operations: Truck,
  relationships: Users, risk: Shield, growth: Rocket, meta: Brain,
  data_quality: Database, odoo: Server,
};
const DOMAIN_COLORS: Record<string, string> = {
  sales: "text-domain-sales", finance: "text-domain-finance", operations: "text-domain-operations",
  relationships: "text-domain-relationships", risk: "text-domain-risk", growth: "text-domain-growth",
  meta: "text-domain-meta", data_quality: "text-info", odoo: "text-warning",
};
const DOMAIN_BG: Record<string, string> = {
  sales: "bg-domain-sales/10", finance: "bg-domain-finance/10", operations: "bg-domain-operations/10",
  relationships: "bg-domain-relationships/10", risk: "bg-domain-risk/10", growth: "bg-domain-growth/10",
  meta: "bg-domain-meta/10", data_quality: "bg-info/10", odoo: "bg-warning/10",
};
const DOMAIN_DESC: Record<string, string> = {
  sales: "Ordenes, CRM, top clientes, oportunidades",
  finance: "Facturas, cartera vencida, cash flow",
  operations: "Entregas, inventario, manufactura",
  relationships: "Health scores, threads, sentimiento",
  risk: "Facturas vencidas, entregas atrasadas, contactos criticos",
  growth: "Top clientes, tendencias, cross-sell",
  meta: "Evalua rendimiento de otros agentes",
  data_quality: "Datos faltantes, links rotos, metricas",
  odoo: "Gaps en sync, modelos faltantes",
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

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [recentInsights, setRecentInsights] = useState<{ id: number; title: string; severity: string; agent_id: number; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const load = useCallback(async () => {
    const [agentsRes, insightsRes] = await Promise.all([
      supabase.rpc("get_agents_overview"),
      supabase
        .from("agent_insights")
        .select("id, title, severity, agent_id, created_at")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setAgents(agentsRes.data ?? []);
    setRecentInsights(insightsRes.data ?? []);
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

  async function handleRunNext() {
    setRunningAll(true);
    try {
      await fetch("/api/agents/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      await load();
    } finally {
      setRunningAll(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agentes de IA" description="Sistema multi-agente de inteligencia" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[160px]" />)}
        </div>
      </div>
    );
  }

  const totalInsights = agents.reduce((s, a) => s + a.total_insights, 0);
  const newInsights = agents.reduce((s, a) => s + a.new_insights, 0);

  return (
    <div className="space-y-5">
      {/* Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <PageHeader
          title="Agentes de IA"
          description={`${agents.length} agentes — ${totalInsights} insights generados${newInsights > 0 ? `, ${newInsights} nuevos` : ""}`}
        />
        <Button
          onClick={handleRunNext}
          disabled={runningAll || runningAgent !== null}
          className="shrink-0 w-full sm:w-auto"
        >
          {runningAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Ejecutar Siguiente
        </Button>
      </div>

      {/* Agent Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((agent) => {
          const Icon = DOMAIN_ICONS[agent.domain] ?? Bot;
          const color = DOMAIN_COLORS[agent.domain] ?? "text-muted-foreground";
          const bg = DOMAIN_BG[agent.domain] ?? "bg-muted";
          const isRunning = runningAgent === agent.slug;
          const desc = DOMAIN_DESC[agent.domain] ?? "";

          return (
            <Card key={agent.slug} className="relative overflow-hidden">
              <CardContent className="pt-4 pb-3 space-y-3">
                {/* Agent header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", bg)}>
                      <Icon className={cn("h-4.5 w-4.5", color)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{desc}</p>
                    </div>
                  </div>
                  {agent.is_active ? (
                    <span className="h-2 w-2 rounded-full bg-success shrink-0 mt-1" title="Activo" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-gray-400 shrink-0 mt-1" title="Inactivo" />
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold tabular-nums">{agent.total_runs}</p>
                    <p className="text-[10px] text-muted-foreground">corridas</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {agent.total_insights}
                      {agent.new_insights > 0 && (
                        <span className="text-xs text-success ml-0.5">+{agent.new_insights}</span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">insights</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {agent.avg_confidence != null ? `${(agent.avg_confidence * 100).toFixed(0)}%` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">confianza</p>
                  </div>
                </div>

                {/* Status + Run button */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                    {agent.last_run_status === "completed" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    ) : agent.last_run_status === "failed" ? (
                      <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
                    ) : agent.last_run_status === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-warning shrink-0" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{agent.last_run_at ? timeAgo(agent.last_run_at) : "nunca ejecutado"}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 px-2.5"
                    onClick={() => handleRun(agent.slug)}
                    disabled={isRunning || runningAll}
                  >
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <><Play className="h-3 w-3 mr-1" /><span className="text-xs">Ejecutar</span></>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent insights — compact preview, links to inbox */}
      {recentInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <Link href="/inbox" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-domain-meta" />
                <CardTitle className="text-sm sm:text-base">Insights Recientes</CardTitle>
                <Badge variant="outline" className="text-[10px]">{newInsights} nuevos</Badge>
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span className="hidden sm:inline text-xs">Ver todos en Inbox</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {recentInsights.map((ins) => {
              const agent = agents.find(a => a.agent_id === ins.agent_id);
              const AgentIcon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
              return (
                <Link
                  key={ins.id}
                  href={`/inbox/insight/${ins.id}`}
                  className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors"
                >
                  <AgentIcon className={cn("h-4 w-4 shrink-0", DOMAIN_COLORS[agent?.domain ?? ""])} />
                  <SeverityBadge severity={ins.severity} />
                  <span className="text-sm font-medium truncate flex-1 min-w-0">{ins.title}</span>
                  <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">{timeAgo(ins.created_at)}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
