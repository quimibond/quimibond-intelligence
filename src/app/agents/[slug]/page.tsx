"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Bot, Loader2, Play } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import type { AIAgent, AgentRun, AgentInsight, AgentMemory } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { TabPerformance } from "./components/tab-performance";
import { TabRuns } from "./components/tab-runs";
import { TabInsights } from "./components/tab-insights";
import { TabMemory } from "./components/tab-memory";

export default function AgentDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<AIAgent | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    // Step 1: Fetch agent by slug
    const { data: agentData, error: agentError } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("slug", slug)
      .single();

    if (agentError || !agentData) {
      setLoading(false);
      return;
    }

    const ag = agentData as AIAgent;
    setAgent(ag);

    // Step 2: Fetch related data in parallel
    const [runsRes, insightsRes, memoriesRes] = await Promise.all([
      supabase
        .from("agent_runs")
        .select("*")
        .eq("agent_id", ag.id)
        .order("started_at", { ascending: false })
        .limit(50),
      supabase
        .from("agent_insights")
        .select("*")
        .eq("agent_id", ag.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("agent_memory")
        .select("*")
        .eq("agent_id", ag.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setRuns((runsRes.data as AgentRun[]) ?? []);
    setInsights((insightsRes.data as AgentInsight[]) ?? []);
    setMemories((memoriesRes.data as AgentMemory[]) ?? []);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRun() {
    if (!agent) return;
    setRunning(true);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_slug: agent.slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          `Error ejecutando agente: ${data.error ?? res.statusText}`
        );
        return;
      }
      toast.success(`Agente ${agent.name} ejecutado correctamente`);
      await load();
    } finally {
      setRunning(false);
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-48" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-10 w-full max-w-lg" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ── Not found ──
  if (!agent) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/agents")}
          className="mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Agentes
        </Button>
        <EmptyState
          icon={Bot}
          title="Agente no encontrado"
          description="El agente solicitado no existe."
        />
      </div>
    );
  }

  const dc = getDomainConfig(agent.domain);
  const Icon = dc.icon;

  const lastRun = runs.length > 0 ? runs[0] : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: "Agentes", href: "/agents" },
          { label: agent.name },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
              dc.bg
            )}
          >
            <Icon className={cn("h-6 w-6", dc.color)} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold sm:text-2xl">{agent.name}</h1>
              {agent.is_active ? (
                <Badge variant="success">Activo</Badge>
              ) : (
                <Badge variant="secondary">Inactivo</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {agent.description ?? dc.description}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <Badge variant="outline">{agent.domain}</Badge>
              {lastRun && (
                <span className="text-xs text-muted-foreground">
                  Ultima corrida: {timeAgo(lastRun.started_at ?? lastRun.created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          onClick={handleRun}
          disabled={running}
          className="shrink-0 w-full sm:w-auto"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Ejecutar Agente
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rendimiento">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="rendimiento">Rendimiento</TabsTrigger>
          <TabsTrigger value="corridas">
            Corridas ({runs.length})
          </TabsTrigger>
          <TabsTrigger value="insights">
            Insights ({insights.length})
          </TabsTrigger>
          <TabsTrigger value="memoria">
            Memoria ({memories.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rendimiento" className="space-y-4">
          <TabPerformance agent={agent} runs={runs} insights={insights} />
        </TabsContent>
        <TabsContent value="corridas">
          <TabRuns runs={runs} />
        </TabsContent>
        <TabsContent value="insights">
          <TabInsights insights={insights} agentDomain={agent.domain} />
        </TabsContent>
        <TabsContent value="memoria">
          <TabMemory memories={memories} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
