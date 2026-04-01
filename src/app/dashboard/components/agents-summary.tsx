"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, Loader2, Play } from "lucide-react";

export function AgentsSummary() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [agents, setAgents] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [insights, setInsights] = useState<any[]>([]);
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    async function load() {
      const [agentsRes, insightsRes] = await Promise.all([
        supabase.rpc("get_agents_overview"),
        supabase.from("agent_insights").select("id, agent_id, title, severity, confidence, insight_type, created_at")
          .in("state", ["new", "seen"]).gte("confidence", 0.65).order("created_at", { ascending: false }).limit(3),
      ]);
      setAgents(agentsRes.data ?? []);
      setInsights(insightsRes.data ?? []);
    }
    load();
  }, []);

  async function runAll() {
    setRunningAll(true);
    try {
      await fetch("/api/agents/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_all: true }),
      });
      const [a, i] = await Promise.all([
        supabase.rpc("get_agents_overview"),
        supabase.from("agent_insights").select("id, agent_id, title, severity, confidence, insight_type, created_at")
          .in("state", ["new", "seen"]).gte("confidence", 0.65).order("created_at", { ascending: false }).limit(3),
      ]);
      setAgents(a.data ?? []);
      setInsights(i.data ?? []);
    } finally { setRunningAll(false); }
  }

  const totalNewInsights = agents.reduce((s: number, a: { new_insights: number }) => s + (a.new_insights ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* Agent cards - horizontal scroll on mobile */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 min-w-0">
          {agents.map((a) => {
            const dc = getDomainConfig(a.domain);
            const Icon = dc.icon;
            return (
              <Link key={a.slug} href="/agents" className="flex items-center gap-2 shrink-0 rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-2 hover:bg-muted/50 transition-colors">
                <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", dc.color)} />
                <div className="text-[11px] sm:text-xs">
                  <p className="font-medium">{a.name?.replace("Agente de ", "")}</p>
                  <p className="text-muted-foreground">
                    {a.new_insights > 0 ? <span className="text-success font-medium">{a.new_insights} nuevos</span> : a.last_run_at ? timeAgo(a.last_run_at) : "nunca"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={runAll} disabled={runningAll} className="shrink-0">
          {runningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          <span className="hidden sm:inline">{runningAll ? "..." : "Ejecutar"}</span>
        </Button>
      </div>

      {/* Latest insights preview */}
      {insights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <Link href="/inbox" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-domain-relationships" />
                <CardTitle className="text-sm sm:text-base">Insights Recientes ({totalNewInsights} nuevos)</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {insights.map((ins) => (
              <Link key={ins.id} href={`/inbox/insight/${ins.id}`} className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors">
                <SeverityBadge severity={ins.severity} />
                <span className="text-sm font-medium truncate flex-1 min-w-0">{ins.title}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">{timeAgo(ins.created_at)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
