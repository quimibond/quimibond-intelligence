"use client";

import { useState } from "react";
import Link from "next/link";
import { cn, timeAgo, truncate } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, Loader2, Play } from "lucide-react";
import type { AIAgent } from "@/lib/types";

interface AgentWithStats extends AIAgent {
  last_run_at: string | null;
  new_insights: number;
}

interface BriefingData {
  briefing_date: string;
  summary_text: string | null;
  total_emails: number;
}

interface AgentsBarProps {
  agents: AgentWithStats[];
  briefing: BriefingData | null;
}

export function AgentsBar({ agents, briefing }: AgentsBarProps) {
  const [running, setRunning] = useState(false);

  async function handleOrchestrate() {
    setRunning(true);
    try {
      await fetch("/api/agents/orchestrate", { method: "POST" });
    } catch (err) {
      console.error("[agents-bar] orchestrate failed:", err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Run button — visible on top for mobile */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{agents.length} agentes activos</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOrchestrate}
          disabled={running}
          className="h-8"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1" />
          )}
          {running ? "Ejecutando..." : "Ejecutar"}
        </Button>
      </div>

      {/* Agent cards: grid on mobile, horizontal scroll on desktop */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:overflow-x-auto sm:pb-1 sm:-mb-1">
        {agents.map((a) => {
          const dc = getDomainConfig(a.domain);
          const Icon = dc.icon;
          return (
            <Link
              key={a.slug}
              href={`/agents/${a.slug}`}
              className="flex flex-col items-center gap-1 rounded-lg border p-2 sm:flex-row sm:gap-2 sm:shrink-0 sm:px-3 sm:py-2 hover:bg-muted/50 transition-colors"
            >
              <Icon className={cn("h-4 w-4", dc.color)} />
              <div className="text-center sm:text-left">
                <p className="text-[10px] sm:text-xs font-medium leading-tight">
                  {a.name?.replace("Agente de ", "").replace("Agente ", "")}
                </p>
                <p className="text-[9px] sm:text-[11px] text-muted-foreground leading-tight">
                  {a.new_insights > 0 ? (
                    <span className="text-success font-medium">
                      {a.new_insights} nuevos
                    </span>
                  ) : a.last_run_at ? (
                    timeAgo(a.last_run_at)
                  ) : (
                    "nunca"
                  )}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Daily briefing */}
      {briefing && (
        <Card>
          <CardHeader className="pb-3">
            <Link href="/briefings" className="flex items-center justify-between group">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-info" />
                <CardTitle className="text-sm sm:text-base truncate">
                  Briefing del Dia — {briefing.briefing_date}
                </CardTitle>
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                  {briefing.total_emails ?? 0} emails
                </span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
            </Link>
          </CardHeader>
          <CardContent>
            <p className="text-sm line-clamp-3 sm:line-clamp-4">
              {briefing.summary_text
                ? truncate(briefing.summary_text, 300)
                : "Sin resumen disponible."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
